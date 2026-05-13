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

function adminNotificationHtml(row: Record<string, unknown>) {
  const lines = Object.entries(row)
    .filter(([key]) => !["tracking_context", "user_agent"].includes(key))
    .map(([key, value]) => `<li><strong>${key}:</strong> ${String(value ?? "")}</li>`)
    .join("");
  return `<p>New Triangulate UK waitlist signup:</p><ul>${lines}</ul>`;
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
    // whether the email was previously seen. Email confirmation only fires
    // for new signups (avoid spamming people who re-submit).
    let userEmailSent = false;
    let adminEmailSent = false;
    if (isNew) {
      const name = cleanText(payload.name, 120);
      const cityForCopy = cleanText(payload.city, 80);
      userEmailSent = await sendEmail(
        email,
        "You're on the Triangulate UK waitlist",
        userConfirmationHtml(name, cityForCopy),
      );
      const adminEmail = env("WAITLIST_ADMIN_EMAIL", env("CONTACT_ADMIN_EMAIL", "triangulate.game@gmail.com"));
      adminEmailSent = await sendEmail(
        adminEmail,
        `New waitlist signup: ${email}${cityForCopy ? ` (${cityForCopy})` : ""}`,
        adminNotificationHtml(row),
      );
    }

    return json({
      ok: true,
      emailSent: userEmailSent,
      adminEmailSent,
      // Don't leak whether the signup is new or duplicate to the client —
      // both look identical externally. The flag above is only true on
      // genuinely new rows because email-send is gated on `isNew`.
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
