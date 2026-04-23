const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type StoredSettings = {
  dry_run?: boolean;
  instagram_access_token?: string | null;
  instagram_user_id?: string | null;
  instagram_graph_base?: string | null;
  tiktok_access_token?: string | null;
  tiktok_privacy_level?: string | null;
  tiktok_disable_duet?: boolean;
  tiktok_disable_comment?: boolean;
  tiktok_disable_stitch?: boolean;
  tiktok_brand_content_toggle?: boolean;
  tiktok_brand_organic_toggle?: boolean;
  tiktok_is_aigc?: boolean;
  updated_at?: string | null;
  updated_by_email?: string | null;
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

function env(name: string) {
  return Deno.env.get(name) || "";
}

function envBoolean(name: string, fallback: boolean) {
  const value = Deno.env.get(name);
  if (value == null || value === "") return fallback;
  return value === "true";
}

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "stored";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function verifyAdmin(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing admin authorization.");

  const supabaseUrl = env("SUPABASE_URL");
  const supabaseAnonKey = env("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) throw new Error("Supabase auth environment is not configured.");

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error("Could not verify admin session.");

  const user = await res.json();
  const email = String(user.email || "").toLowerCase();
  const adminEmail = (env("ADMIN_EMAIL") || "triangulate.game@gmail.com").toLowerCase();
  if (email !== adminEmail) throw new Error("This account is not allowed to manage publishing settings.");
  return email;
}

async function getStoredSettings() {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase database environment is not configured.");

  const res = await fetch(`${supabaseUrl}/rest/v1/social_publish_settings?id=eq.1&select=*`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error("Could not load publish settings.");
  const rows = await res.json().catch(() => []);
  return (Array.isArray(rows) ? rows[0] : null) as StoredSettings | null;
}

async function saveStoredSettings(patch: Record<string, unknown>) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase database environment is not configured.");

  const res = await fetch(`${supabaseUrl}/rest/v1/social_publish_settings`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id: 1,
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) throw new Error("Could not save publish settings.");
  const rows = await res.json().catch(() => []);
  return (Array.isArray(rows) ? rows[0] : null) as StoredSettings | null;
}

function toPublicSettings(stored: StoredSettings | null) {
  const instagramAccessToken = trimString(stored?.instagram_access_token) || env("INSTAGRAM_ACCESS_TOKEN");
  const instagramUserId =
    trimString(stored?.instagram_user_id) || env("INSTAGRAM_USER_ID") || env("INSTAGRAM_BUSINESS_ACCOUNT_ID");
  const instagramGraphBase =
    trimString(stored?.instagram_graph_base) || env("INSTAGRAM_GRAPH_BASE") || "https://graph.facebook.com/v24.0";
  const tiktokAccessToken = trimString(stored?.tiktok_access_token) || env("TIKTOK_ACCESS_TOKEN");
  const tiktokPrivacyLevel =
    trimString(stored?.tiktok_privacy_level) || env("TIKTOK_PRIVACY_LEVEL") || "SELF_ONLY";

  return {
    dryRun:
      typeof stored?.dry_run === "boolean" ? stored.dry_run : envBoolean("SOCIAL_PUBLISH_DRY_RUN", true),
    instagram: {
      configured: Boolean(instagramAccessToken && instagramUserId),
      accessTokenConfigured: Boolean(instagramAccessToken),
      tokenPreview: maskSecret(instagramAccessToken),
      userId: instagramUserId,
      graphBase: instagramGraphBase,
    },
    tiktok: {
      configured: Boolean(tiktokAccessToken),
      accessTokenConfigured: Boolean(tiktokAccessToken),
      tokenPreview: maskSecret(tiktokAccessToken),
      privacyLevel: tiktokPrivacyLevel,
      disableDuet:
        typeof stored?.tiktok_disable_duet === "boolean"
          ? stored.tiktok_disable_duet
          : envBoolean("TIKTOK_DISABLE_DUET", false),
      disableComment:
        typeof stored?.tiktok_disable_comment === "boolean"
          ? stored.tiktok_disable_comment
          : envBoolean("TIKTOK_DISABLE_COMMENT", false),
      disableStitch:
        typeof stored?.tiktok_disable_stitch === "boolean"
          ? stored.tiktok_disable_stitch
          : envBoolean("TIKTOK_DISABLE_STITCH", false),
      brandContentToggle:
        typeof stored?.tiktok_brand_content_toggle === "boolean"
          ? stored.tiktok_brand_content_toggle
          : envBoolean("TIKTOK_BRAND_CONTENT_TOGGLE", false),
      brandOrganicToggle:
        typeof stored?.tiktok_brand_organic_toggle === "boolean"
          ? stored.tiktok_brand_organic_toggle
          : envBoolean("TIKTOK_BRAND_ORGANIC_TOGGLE", true),
      isAigc:
        typeof stored?.tiktok_is_aigc === "boolean"
          ? stored.tiktok_is_aigc
          : envBoolean("TIKTOK_IS_AIGC", false),
    },
    updatedAt: stored?.updated_at || null,
    updatedByEmail: stored?.updated_by_email || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const adminEmail = await verifyAdmin(req);

    if (req.method === "GET") {
      const stored = await getStoredSettings();
      return json({
        ok: true,
        adminEmail,
        settings: toPublicSettings(stored),
      });
    }

    const body = await req.json().catch(() => ({}));
    const incoming = body?.settings || {};
    const patch: Record<string, unknown> = {
      dry_run: Boolean(incoming.dryRun),
      instagram_user_id: trimString(incoming.instagramUserId) || null,
      instagram_graph_base: trimString(incoming.instagramGraphBase) || "https://graph.facebook.com/v24.0",
      tiktok_privacy_level: trimString(incoming.tiktokPrivacyLevel) || "SELF_ONLY",
      tiktok_disable_duet: Boolean(incoming.tiktokDisableDuet),
      tiktok_disable_comment: Boolean(incoming.tiktokDisableComment),
      tiktok_disable_stitch: Boolean(incoming.tiktokDisableStitch),
      tiktok_brand_content_toggle: Boolean(incoming.tiktokBrandContentToggle),
      tiktok_brand_organic_toggle: incoming.tiktokBrandOrganicToggle !== false,
      tiktok_is_aigc: Boolean(incoming.tiktokIsAigc),
      updated_by_email: adminEmail,
    };

    if (trimString(incoming.instagramAccessToken)) {
      patch.instagram_access_token = trimString(incoming.instagramAccessToken);
    } else if (incoming.clearInstagramToken) {
      patch.instagram_access_token = null;
    }

    if (trimString(incoming.tiktokAccessToken)) {
      patch.tiktok_access_token = trimString(incoming.tiktokAccessToken);
    } else if (incoming.clearTiktokToken) {
      patch.tiktok_access_token = null;
    }

    const stored = await saveStoredSettings(patch);
    return json({
      ok: true,
      adminEmail,
      settings: toPublicSettings(stored),
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not manage publish settings.",
      },
      400
    );
  }
});
