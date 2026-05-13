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

function env(name: string, fallback = "") {
  return Deno.env.get(name) || fallback;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const UK_CITIES = new Set([
  "London", "Manchester", "Birmingham", "Edinburgh", "Bristol",
  "Leeds", "Glasgow", "Liverpool", "Newcastle", "Sheffield",
  "Nottingham", "Cardiff", "Belfast", "Other",
]);

async function insertWaitlistSignup(payload: Record<string, unknown>, req: Request) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Waitlist storage is not configured.");
  }

  const trackingContext = payload.trackingContext && typeof payload.trackingContext === "object"
    ? payload.trackingContext
    : {};

  const row = {
    email: cleanText(payload.email, 160).toLowerCase(),
    name: cleanText(payload.name, 120) || null,
    city: cleanText(payload.city, 80) || null,
    age_confirmed: Boolean(payload.ageConfirmed),
    analytics_consent: Boolean(payload.analyticsConsent),
    utm_source: cleanText(payload.utmSource, 80) || null,
    utm_medium: cleanText(payload.utmMedium, 80) || null,
    utm_campaign: cleanText(payload.utmCampaign, 80) || null,
    utm_content: cleanText(payload.utmContent, 120) || null,
    utm_term: cleanText(payload.utmTerm, 80) || null,
    source_page: cleanText(payload.sourcePage, 240) || null,
    referrer: cleanText(payload.referrer, 500) || null,
    tracking_context: trackingContext,
    user_agent: cleanText(req.headers.get("user-agent"), 500) || null,
  };

  // Insert with on-conflict-do-nothing on the email unique constraint, so
  // re-submitting an email is a silent success (we don't reveal whether the
  // address was previously seen). PostgREST honors the `resolution=ignore-duplicates`
  // preference when the target column has a unique constraint.
  const res = await fetch(`${supabaseUrl}/rest/v1/waitlist?on_conflict=email`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || `Could not save waitlist signup (${res.status}).`);
  }
  const inserted = Array.isArray(body) && body.length > 0 ? body[0] : null;
  return { isNew: Boolean(inserted), row: inserted ?? row };
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = env("RESEND_API_KEY");
  const from = env("WAITLIST_FROM_EMAIL", env("CONTACT_FROM_EMAIL", "Triangulate <hello@triangulate.live>"));
  if (!apiKey) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return res.ok;
}

function userConfirmationHtml(name: string, city: string) {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const cityLine = city && city !== "Other"
    ? `We're rolling sessions out city by city across the UK. ${city} is on the list — we'll email you the moment there's a session you can join there.`
    : "We'll email you the moment there's a session you can join in your city.";
  return `
    <p>${greeting}</p>
    <p>You're on the Triangulate UK waitlist.</p>
    <p>${cityLine}</p>
    <p>Three players form a triangle in real space, move with purpose, and try to beat smaller teams. ~20-minute sessions, outdoors — the phone's the map, not the show.</p>
    <p>If a mate would enjoy this, send them <a href="https://triangulate.live/waitlist">triangulate.live/waitlist</a> — bigger waitlist = more cities in the rollout.</p>
    <p>— The Triangulate team</p>
  `;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }) + " UK";
}

function adminNotificationHtml(row: Record<string, unknown>, links: { attioRecordId?: string } = {}) {
  const name = String(row.name || "").trim();
  const email = String(row.email || "").trim();
  const city = String(row.city || "").trim();
  const created = formatTime(String(row.created_at || ""));
  const headline = name
    ? `<strong>${escapeHtml(name)}</strong>${city ? ` (${escapeHtml(city)})` : ""} joined the UK waitlist`
    : `<strong>${escapeHtml(email)}</strong>${city ? ` (${escapeHtml(city)})` : ""} joined the UK waitlist`;

  const utm = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
    .map((k) => ({ k, v: String(row[k] || "").trim() }))
    .filter((p) => p.v);
  const acquisitionLine = utm.length
    ? `<p><strong>Acquisition:</strong> ${utm.map((p) => `${p.k.replace("utm_", "")}=${escapeHtml(p.v)}`).join(" · ")}</p>`
    : `<p><strong>Acquisition:</strong> direct (no UTMs)</p>`;

  const sourcePage = String(row.source_page || "").trim();
  const referrer = String(row.referrer || "").trim();
  const sourceParts = [
    sourcePage ? `page <code>${escapeHtml(sourcePage)}</code>` : null,
    referrer ? `referrer ${escapeHtml(referrer)}` : null,
  ].filter(Boolean);
  const sourceLine = sourceParts.length ? `<p><strong>Source:</strong> ${sourceParts.join(" · ")}</p>` : "";

  const attioLink = links.attioRecordId
    ? `<p><a href="https://app.attio.com/triangulate/person/${links.attioRecordId}">→ View in Attio</a></p>`
    : "";

  const rowId = String(row.id || "");

  return `
    <p>${headline}.</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}<br/>
    <strong>When:</strong> ${escapeHtml(created)}</p>
    ${acquisitionLine}
    ${sourceLine}
    ${attioLink}
    <hr style="border:none;border-top:1px solid #ddd;margin:1em 0;"/>
    <p style="color:#888;font-size:12px;">Waitlist row id: <code>${escapeHtml(rowId)}</code></p>
  `;
}

/**
 * Push the signup into Attio CRM as a Person record. Reuses the existing
 * Triangulate workspace's `people` object with these defaults — no schema
 * additions required:
 *   - segment: "community" (closest existing option for inbound/self-served)
 *   - status: "target" (downstream pipeline starts at target, then "contacted"
 *     etc. — admin can re-tag later in Attio)
 *   - source_tracker: "waitlist-signup" (lets admin filter to a clean
 *     "Waitlist Signups" view without a new segment)
 *   - phase: "1" · cohort: "B" (we enforce 18+ at signup)
 * Best-effort: failures here are logged but never break the signup.
 */
async function postToAttio(row: Record<string, unknown>) {
  const apiKey = env("ATTIO_API_KEY");
  if (!apiKey) return { skipped: true, reason: "ATTIO_API_KEY not set" };

  const fullName = String(row.name || "").trim();
  const firstName = fullName.split(/\s+/)[0] || "";
  const lastName = fullName.split(/\s+/).slice(1).join(" ") || "";
  const city = String(row.city || "").trim();
  const utmSource = String(row.utm_source || "").trim();
  const utmCampaign = String(row.utm_campaign || "").trim();
  const notesParts = [
    `Waitlist signup ${String(row.created_at || "").slice(0, 10)}`,
    city ? `city=${city}` : null,
    utmSource ? `utm_source=${utmSource}` : null,
    utmCampaign ? `utm_campaign=${utmCampaign}` : null,
  ].filter(Boolean);

  const values: Record<string, unknown> = {
    email_addresses: [{ email_address: String(row.email) }],
    segment: [{ option: "community" }],
    status: [{ status: "target" }],
    cohort: [{ option: "B" }],
    phase: [{ option: "1" }],
    channel: [{ option: "web form" }],
    source_tracker: [{ value: "waitlist-signup" }],
    last_action: [{ value: String(row.created_at || "").slice(0, 10) }],
    notes: [{ value: notesParts.join(" · ") }],
  };
  if (fullName) {
    values.name = [{ first_name: firstName, last_name: lastName, full_name: fullName }];
  }

  const res = await fetch("https://api.attio.com/v2/objects/people/records", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { values } }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, status: res.status, error: body.slice(0, 300) };
  }
  const json = await res.json();
  return { ok: true, record_id: json?.data?.id?.record_id };
}

/**
 * Server-side Mixpanel event. Idempotent on Mixpanel's side via $insert_id =
 * waitlist row UUID. Properties match the standard utm/campaign analytics
 * shape so dashboards can pivot by source / campaign / city.
 * No-ops if MIXPANEL_TOKEN is not set.
 */
async function trackMixpanel(row: Record<string, unknown>) {
  const token = env("MIXPANEL_TOKEN");
  if (!token) return { skipped: true, reason: "MIXPANEL_TOKEN not set" };

  const apiHost = env("MIXPANEL_API_HOST", "https://api-eu.mixpanel.com");
  const email = String(row.email || "");
  const createdAt = row.created_at ? new Date(String(row.created_at)).getTime() / 1000 : Date.now() / 1000;

  const event = {
    event: "Waitlist Joined",
    properties: {
      token,
      time: Math.floor(createdAt),
      $insert_id: String(row.id || crypto.randomUUID()),
      distinct_id: email,
      $email: email,
      city: row.city || null,
      utm_source: row.utm_source || null,
      utm_medium: row.utm_medium || null,
      utm_campaign: row.utm_campaign || null,
      utm_content: row.utm_content || null,
      utm_term: row.utm_term || null,
      source_page: row.source_page || null,
      referrer: row.referrer || null,
      age_confirmed: row.age_confirmed,
      analytics_consent: row.analytics_consent,
    },
  };

  // Mixpanel /track accepts a single event or array as form-encoded `data` param
  // (the JSON-body form also works but `data` is the documented contract).
  const body = new URLSearchParams({ data: JSON.stringify([event]) });
  const res = await fetch(`${apiHost}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok || text.trim() === "0") {
    return { ok: false, status: res.status, error: text.slice(0, 200) };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const payload = await req.json();

    // Honeypot — bots fill this; humans don't see it (CSS-hidden).
    if (cleanText(payload._hp, 200)) {
      return json({ ok: true, ignored: true });
    }

    const email = cleanText(payload.email, 160).toLowerCase();
    if (!isEmail(email)) throw new Error("A valid email is required.");
    if (!payload.ageConfirmed) throw new Error("Please confirm you're 18 or over.");
    if (!payload.responseConsent) throw new Error("Please confirm consent before joining.");

    const city = cleanText(payload.city, 80);
    if (city && !UK_CITIES.has(city)) {
      // City sent but not on our list — silently downgrade to "Other"
      // rather than reject the signup over a UI-only constraint.
      payload.city = "Other";
    }

    const { isNew, row } = await insertWaitlistSignup(payload, req);

    // Always reply success regardless of new-vs-duplicate to avoid revealing
    // whether the email was previously seen. Email + CRM + analytics fire
    // only for new signups (avoid duplicate work).
    let userEmailSent = false;
    let adminEmailSent = false;
    let attioResult: unknown = { skipped: true, reason: "not new" };
    let mixpanelResult: unknown = { skipped: true, reason: "not new" };
    if (isNew) {
      // Side-effects are independently wrapped so any one failure doesn't
      // block the others, and a thrown error from any of them doesn't break
      // the signup response. The signup is already persisted; downstream
      // failures are logged in the response body for Dashboard inspection.
      const name = cleanText(payload.name, 120);
      const cityForCopy = cleanText(payload.city, 80);

      // Fire Attio first so the admin notification can link to the new
      // CRM record. Then run the other three in parallel.
      attioResult = await postToAttio(row).catch((err) => {
        console.error("attio failed:", err);
        return { ok: false, error: err.message };
      });
      const attioRecordId = (attioResult as { record_id?: string })?.record_id;
      const adminSubject = `New signup: ${name || email}${cityForCopy ? ` (${cityForCopy})` : ""}`;

      [userEmailSent, adminEmailSent, mixpanelResult] = await Promise.all([
        sendEmail(email, "You're on the Triangulate UK waitlist", userConfirmationHtml(name, cityForCopy)).catch(
          (err) => { console.error("user email failed:", err); return false; },
        ),
        sendEmail(
          env("WAITLIST_ADMIN_EMAIL", env("CONTACT_ADMIN_EMAIL", "triangulate.game@gmail.com")),
          adminSubject,
          adminNotificationHtml(row, { attioRecordId }),
        ).catch((err) => { console.error("admin email failed:", err); return false; }),
        trackMixpanel(row).catch((err) => { console.error("mixpanel failed:", err); return { ok: false, error: err.message }; }),
      ]);
    }

    return json({
      ok: true,
      emailSent: userEmailSent,
      adminEmailSent,
      attio: attioResult,
      mixpanel: mixpanelResult,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to join the waitlist right now.",
      },
      400,
    );
  }
});
