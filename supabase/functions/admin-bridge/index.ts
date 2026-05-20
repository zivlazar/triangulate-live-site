// Admin bridge — proxies read-only Mixpanel + Attio calls for the event admin UI.
//
// Why a server-side bridge?
//   - Mixpanel + Attio API keys never touch the browser.
//   - Caller authentication is verified server-side against admin_users.
//
// If either upstream API key is unset, the function returns a clearly-marked
// `mock: true` payload so the admin UI keeps rendering meaningful data during
// development.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string): string {
  return Deno.env.get(name) || "";
}

async function requireAdmin(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  const supabaseUrl = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey || !token) return null;

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  const email = String(user?.email || "").toLowerCase();
  if (!email) return null;

  const adminRes = await fetch(
    `${supabaseUrl}/rest/v1/admin_users?email=eq.${encodeURIComponent(email)}&select=email`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } },
  );
  if (!adminRes.ok) return null;
  const rows = await adminRes.json();
  return Array.isArray(rows) && rows.length ? email : null;
}

// ─── Mixpanel summary ─────────────────────────────────────────────────────

async function fetchMixpanel() {
  const username = env("MIXPANEL_SERVICE_ACCOUNT_USERNAME");
  const secret = env("MIXPANEL_SERVICE_ACCOUNT_SECRET");
  const projectId = env("MIXPANEL_PROJECT_ID") || "4004554";
  const region = env("MIXPANEL_REGION") || "EU";

  if (!username || !secret) {
    return { live: false, project: projectId, region, note: "Mixpanel credentials not configured." };
  }

  const base = region === "EU"
    ? "https://eu.mixpanel.com/api/query"
    : "https://mixpanel.com/api/query";

  const auth = "Basic " + btoa(`${username}:${secret}`);
  const todayIso = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const events = ["Waitlist Joined", "Event Viewed", "Registration Started", "Registration Completed", "Event Attended"];
  const counts: { step: string; count: number }[] = [];

  for (const ev of events) {
    try {
      const url = `${base}/segmentation?project_id=${projectId}` +
        `&from_date=${ninetyDaysAgoIso}&to_date=${todayIso}` +
        `&event=${encodeURIComponent(ev)}&unit=day&type=unique`;
      const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" } });
      if (!res.ok) {
        counts.push({ step: ev, count: 0 });
        continue;
      }
      const data = await res.json();
      const series = data?.data?.values?.[ev] || {};
      const total = Object.values(series).reduce((sum: number, v: unknown) => sum + (Number(v) || 0), 0);
      counts.push({ step: ev, count: Number(total) });
    } catch {
      counts.push({ step: ev, count: 0 });
    }
  }

  return {
    live: true,
    project: projectId,
    region,
    funnel: counts,
    window: `${ninetyDaysAgoIso} → ${todayIso}`,
    note: `Live read from Mixpanel project ${projectId} (${region}).`,
  };
}

// ─── Attio summary ────────────────────────────────────────────────────────

async function fetchAttio() {
  const apiKey = env("ATTIO_API_KEY");
  if (!apiKey) {
    return { live: false, note: "Attio API key not configured." };
  }

  try {
    const res = await fetch("https://api.attio.com/v2/objects/people/records/query", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 25, sorts: [{ direction: "desc", attribute: "created_at" }] }),
    });
    if (!res.ok) {
      return { live: false, note: `Attio HTTP ${res.status}.` };
    }
    const data = await res.json();
    const sample = (data.data || []).slice(0, 12).map((rec: Record<string, unknown>) => {
      const values = (rec.values || {}) as Record<string, unknown>;
      const firstVal = (key: string): string => {
        const arr = values[key];
        if (Array.isArray(arr) && arr[0]) {
          const v = arr[0] as Record<string, unknown>;
          return String(v.value || v.email_address || v.full_name || v.name || "");
        }
        return "";
      };
      return {
        person_id: ((rec.id as Record<string, unknown>)?.record_id as string) || "—",
        email: firstVal("email_addresses"),
        name: firstVal("name") || firstVal("full_name"),
        segment: firstVal("segment"),
        status: firstVal("status_verbose") || firstVal("status"),
      };
    });
    return {
      live: true,
      workspace: "triangulate",
      sample,
      total_returned: sample.length,
      note: `Live read from Attio (latest ${sample.length} people).`,
    };
  } catch (err) {
    return { live: false, note: `Attio fetch error: ${err instanceof Error ? err.message : "unknown"}.` };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const adminEmail = await requireAdmin(req);
  if (!adminEmail) return json({ error: "Forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* allow empty body */ }

  const scope = String(body?.scope || "summary");
  if (scope !== "summary") return json({ error: "Unknown scope" }, 400);

  const [mixpanel, attio] = await Promise.all([
    fetchMixpanel().catch((err) => ({ live: false, note: `Mixpanel error: ${err?.message || "unknown"}` })),
    fetchAttio().catch((err) => ({ live: false, note: `Attio error: ${err?.message || "unknown"}` })),
  ]);

  return json({ mixpanel, attio, requested_by: adminEmail });
});
