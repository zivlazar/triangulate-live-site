const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Draft = {
  channel?: string;
  title?: string;
  caption?: string;
  hashtags?: string[];
  fallbackCopy?: {
    caption?: string;
    hashtags?: string[];
  };
};

type Decision = {
  copyMode?: string;
  mediaUrl?: string;
};

type PublishItem = {
  index: number;
  draft: Draft;
  decision: Decision;
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

function envBoolean(name: string) {
  const value = Deno.env.get(name);
  if (value == null || value === "") return null;
  return value === "true";
}

function captionFor(item: PublishItem) {
  const useFallback = item.decision.copyMode === "general" && item.draft.fallbackCopy;
  const caption = useFallback ? item.draft.fallbackCopy?.caption : item.draft.caption;
  const hashtags = useFallback ? item.draft.fallbackCopy?.hashtags : item.draft.hashtags;
  return [caption, (hashtags || []).join(" ")].filter(Boolean).join("\n\n").trim();
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
  const adminEmail = env("ADMIN_EMAIL", "triangulate.game@gmail.com").toLowerCase();
  if (email !== adminEmail) throw new Error("This account is not allowed to publish.");
  return email;
}

async function loadStoredSettings() {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  const res = await fetch(`${supabaseUrl}/rest/v1/social_publish_settings?id=eq.1&select=*`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;

  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function mediaKind(item: PublishItem) {
  const channel = String(item.draft.channel || "").toLowerCase();
  const mediaUrl = String(item.decision.mediaUrl || "");
  if (/\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl)) return "video";
  if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(mediaUrl)) return "image";
  if (channel.includes("tiktok") || channel.includes("reel")) return "video";
  return "image";
}

function assertMediaUrl(item: PublishItem) {
  const mediaUrl = String(item.decision.mediaUrl || "").trim();
  if (!mediaUrl) throw new Error("Missing public media URL.");
  if (!/^https:\/\//i.test(mediaUrl)) throw new Error("Media URL must be public HTTPS.");
  return mediaUrl;
}

async function publishInstagram(item: PublishItem, storedSettings: Record<string, unknown> | null) {
  const accessToken = String(storedSettings?.instagram_access_token || "") || env("INSTAGRAM_ACCESS_TOKEN");
  const userId =
    String(storedSettings?.instagram_user_id || "") || env("INSTAGRAM_USER_ID") || env("INSTAGRAM_BUSINESS_ACCOUNT_ID");
  const graphBase = (
    String(storedSettings?.instagram_graph_base || "") || env("INSTAGRAM_GRAPH_BASE", "https://graph.facebook.com/v24.0")
  ).replace(/\/$/, "");
  const dryRun =
    typeof storedSettings?.dry_run === "boolean"
      ? storedSettings.dry_run
      : env("SOCIAL_PUBLISH_DRY_RUN", "true") !== "false";

  if (!accessToken || !userId) throw new Error("Instagram publishing credentials are not configured.");

  const mediaUrl = assertMediaUrl(item);
  const kind = mediaKind(item);
  const caption = captionFor(item);
  const channel = String(item.draft.channel || "").toLowerCase();

  if (channel.includes("story") || channel.includes("carousel")) {
    return {
      platform: "instagram",
      status: "skipped_unsupported_format",
      message: "Direct publishing currently supports single image posts and Reels. Use manual posting for stories/carousels.",
    };
  }

  if (dryRun) {
    return {
      platform: "instagram",
      status: "dry_run",
      mediaKind: kind,
      caption,
    };
  }

  const createBody = new URLSearchParams({
    caption,
    access_token: accessToken,
  });
  if (kind === "video") {
    createBody.set("media_type", "REELS");
    createBody.set("video_url", mediaUrl);
  } else {
    createBody.set("image_url", mediaUrl);
  }

  const createRes = await fetch(`${graphBase}/${userId}/media`, {
    method: "POST",
    body: createBody,
  });
  const createJson = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createJson.id) {
    throw new Error(createJson.error?.message || "Instagram media container creation failed.");
  }

  const publishRes = await fetch(`${graphBase}/${userId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({
      creation_id: createJson.id,
      access_token: accessToken,
    }),
  });
  const publishJson = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok) {
    throw new Error(publishJson.error?.message || "Instagram publish failed.");
  }

  return {
    platform: "instagram",
    status: "published",
    id: publishJson.id,
    creationId: createJson.id,
  };
}

async function publishTikTok(item: PublishItem, storedSettings: Record<string, unknown> | null) {
  const accessToken = String(storedSettings?.tiktok_access_token || "") || env("TIKTOK_ACCESS_TOKEN");
  const dryRun =
    typeof storedSettings?.dry_run === "boolean"
      ? storedSettings.dry_run
      : env("SOCIAL_PUBLISH_DRY_RUN", "true") !== "false";
  if (!accessToken) throw new Error("TikTok publishing credentials are not configured.");

  const mediaUrl = assertMediaUrl(item);
  if (mediaKind(item) !== "video") throw new Error("TikTok direct publishing requires a video media URL.");

  const payload = {
    post_info: {
      title: captionFor(item).slice(0, 2200),
      privacy_level: String(storedSettings?.tiktok_privacy_level || "") || env("TIKTOK_PRIVACY_LEVEL", "SELF_ONLY"),
      disable_duet:
        typeof storedSettings?.tiktok_disable_duet === "boolean"
          ? storedSettings.tiktok_disable_duet
          : env("TIKTOK_DISABLE_DUET", "false") === "true",
      disable_comment:
        typeof storedSettings?.tiktok_disable_comment === "boolean"
          ? storedSettings.tiktok_disable_comment
          : env("TIKTOK_DISABLE_COMMENT", "false") === "true",
      disable_stitch:
        typeof storedSettings?.tiktok_disable_stitch === "boolean"
          ? storedSettings.tiktok_disable_stitch
          : env("TIKTOK_DISABLE_STITCH", "false") === "true",
      brand_content_toggle:
        typeof storedSettings?.tiktok_brand_content_toggle === "boolean"
          ? storedSettings.tiktok_brand_content_toggle
          : env("TIKTOK_BRAND_CONTENT_TOGGLE", "false") === "true",
      brand_organic_toggle:
        typeof storedSettings?.tiktok_brand_organic_toggle === "boolean"
          ? storedSettings.tiktok_brand_organic_toggle
          : env("TIKTOK_BRAND_ORGANIC_TOGGLE", "true") === "true",
      is_aigc:
        typeof storedSettings?.tiktok_is_aigc === "boolean"
          ? storedSettings.tiktok_is_aigc
          : env("TIKTOK_IS_AIGC", "false") === "true",
    },
    source_info: {
      source: "PULL_FROM_URL",
      video_url: mediaUrl,
    },
  };

  if (dryRun) {
    return {
      platform: "tiktok",
      status: "dry_run",
      payload,
    };
  }

  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error?.code !== "ok") {
    throw new Error(body.error?.message || "TikTok publish init failed.");
  }

  return {
    platform: "tiktok",
    status: "publish_initialized",
    publishId: body.data?.publish_id,
  };
}

async function publishItem(item: PublishItem, storedSettings: Record<string, unknown> | null) {
  const channel = String(item.draft.channel || "").toLowerCase();
  if (channel.includes("tiktok")) return publishTikTok(item, storedSettings);
  if (channel.includes("instagram")) return publishInstagram(item, storedSettings);
  return {
    platform: "unknown",
    status: "skipped_unknown_channel",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const adminEmail = await verifyAdmin(req);
    const storedSettings = await loadStoredSettings();
    const body = await req.json();
    const drafts = Array.isArray(body.drafts) ? body.drafts : [];
    if (!drafts.length) throw new Error("No approved drafts supplied.");

    const results = [];
    for (const item of drafts) {
      try {
        results.push({
          index: item.index,
          ...(await publishItem(item, storedSettings)),
        });
      } catch (error) {
        results.push({
          index: item.index,
          platform: item.draft?.channel || "unknown",
          status: "failed",
          error: error instanceof Error ? error.message : "Publish failed.",
        });
      }
    }

    return json({
      ok: true,
      adminEmail,
      dryRun:
        typeof storedSettings?.dry_run === "boolean"
          ? storedSettings.dry_run
          : envBoolean("SOCIAL_PUBLISH_DRY_RUN") ?? true,
      queueFile: body.queueFile || "",
      results,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Publishing failed.",
      },
      400,
    );
  }
});
