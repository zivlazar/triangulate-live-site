const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ApprovalRow = {
  id: string;
  token: string;
  status: string;
  title: string;
  host: string;
  scheduled: string;
  plan_note: string | null;
  approved_at: string | null;
  rejected_at: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function env(name: string, fallback = "") {
  return Deno.env.get(name) || fallback;
}

function cleanToken(value: unknown) {
  return String(value ?? "").trim().slice(0, 240);
}

async function fetchRequest(token: string): Promise<ApprovalRow | null> {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Event approval storage is not configured.");

  const url = new URL(`${supabaseUrl}/rest/v1/event_approval_requests`);
  url.searchParams.set("token", `eq.${token}`);
  url.searchParams.set("select", "id,token,status,title,host,scheduled,plan_note,approved_at,rejected_at");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw new Error(rows.message || "Could not load event approval request.");
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function updateRequest(id: string, action: "approve" | "reject") {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Event approval storage is not configured.");

  const now = new Date().toISOString();
  const patch = {
    status: action === "approve" ? "approved" : "rejected",
    handled_action: action,
    handled_at: now,
    approved_at: action === "approve" ? now : null,
    rejected_at: action === "reject" ? now : null,
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/event_approval_requests?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "Could not update event approval request.");
  return Array.isArray(body) ? body[0] : body;
}

function previewResponse(row: ApprovalRow) {
  if (row.status === "approved") {
    return {
      ok: true,
      terminal: true,
      title: "Event already approved",
      message: "This event has already been approved.",
    };
  }
  if (row.status === "rejected") {
    return {
      ok: true,
      terminal: true,
      title: "Event already rejected",
      message: "This event has already been rejected.",
    };
  }
  return {
    ok: true,
    terminal: false,
    event: {
      title: row.title,
      host: row.host,
      scheduled: row.scheduled,
      plan_note: row.plan_note,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const body = await req.json();
    const action = String(body.action || "preview").toLowerCase();
    const token = cleanToken(body.token);
    if (!token) throw new Error("Missing token.");
    if (!["preview", "approve", "reject"].includes(action)) throw new Error("Invalid action.");

    const row = await fetchRequest(token);
    if (!row) throw new Error("This approval link was not found in the new live-site project.");

    if (action === "preview") {
      return json(previewResponse(row));
    }

    if (row.status !== "pending") {
      return json(previewResponse(row));
    }

    await updateRequest(row.id, action as "approve" | "reject");
    return json({
      ok: true,
      message: action === "approve"
        ? "The event approval request has been marked approved."
        : "The event approval request has been marked rejected.",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Event approval failed.",
      },
      400,
    );
  }
});
