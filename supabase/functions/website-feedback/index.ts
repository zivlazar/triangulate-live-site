const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function insertFeedback(payload: Record<string, unknown>, req: Request) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Feedback storage is not configured.");

  const row = {
    name: cleanText(payload.name, 120),
    email: cleanText(payload.email, 160).toLowerCase(),
    phone_number: cleanText(payload.phoneNumber, 40) || null,
    company_name: cleanText(payload.companyName, 160) || null,
    query: cleanText(payload.query, 5000),
    analytics_consent: Boolean(payload.analyticsConsent),
    response_consent: Boolean(payload.responseConsent),
    source_page: cleanText(payload.sourcePage, 240) || null,
    referrer: cleanText(payload.referrer, 500) || null,
    tracking_context: payload.trackingContext && typeof payload.trackingContext === "object"
      ? payload.trackingContext
      : {},
    user_agent: cleanText(req.headers.get("user-agent"), 500) || null,
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/website_feedback`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  const jsonBody = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(jsonBody.message || "Could not store feedback.");
  return Array.isArray(jsonBody) ? jsonBody[0] : jsonBody;
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = env("RESEND_API_KEY");
  const from = env("CONTACT_FROM_EMAIL", "Triangulate <hello@triangulate.live>");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const payload = await req.json();
    if (cleanText(payload._hp, 200)) {
      return json({ ok: true, ignored: true });
    }

    const name = cleanText(payload.name, 120);
    const email = cleanText(payload.email, 160).toLowerCase();
    const query = cleanText(payload.query, 5000);
    if (!name) throw new Error("Name is required.");
    if (!isEmail(email)) throw new Error("A valid email is required.");
    if (!query) throw new Error("Your query is required.");
    if (wordCount(query) > 500) throw new Error("Your query must be 500 words or fewer.");
    if (!payload.responseConsent) throw new Error("Consent is required before sending.");

    const row = await insertFeedback(payload, req);
    const adminEmail = env("CONTACT_ADMIN_EMAIL", "triangulate.game@gmail.com");
    const escapedQuery = query.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char] || char));

    const userEmailSent = await sendEmail(
      email,
      "We received your Triangulate message",
      `<p>Hi ${name},</p><p>Thanks for contacting Triangulate. We received your message and will reply soon.</p>`,
    );
    const adminEmailSent = await sendEmail(
      adminEmail,
      `Triangulate website enquiry from ${name}`,
      `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p><p>${escapedQuery}</p>`,
    );

    return json({
      ok: true,
      id: row?.id,
      emailSent: userEmailSent,
      adminEmailSent,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to send your message right now.",
      },
      400,
    );
  }
});
