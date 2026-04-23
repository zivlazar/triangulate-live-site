#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_CONFIG_PATH = path.join(ROOT, "social-agent", "config.example.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "social-agent", "out");
const FALLBACK_TREND_SIGNALS = [
  {
    key: "real_world_play",
    angle: "Games are becoming more social when the real place matters.",
    publicHook: "Your local park can be more than a backdrop.",
  },
  {
    key: "co_op_presence",
    angle: "Co-op play feels stronger when teammates have to move and make decisions together.",
    publicHook: "The best team chat is sometimes a sprint across open ground.",
  },
  {
    key: "fast_mobile_sessions",
    angle: "Mobile games are easier to try when the first session is quick, visible, and social.",
    publicHook: "No long setup. No mystery rules. Just meet, move, and learn fast.",
  },
  {
    key: "map_as_game_board",
    angle: "Players are interested in games where maps become active play spaces.",
    publicHook: "The map is not the menu. The map is the match.",
  },
  {
    key: "team_strategy",
    angle: "Team strategy is more exciting when positioning matters as much as speed.",
    publicHook: "Fast helps. Shape wins.",
  },
  {
    key: "outdoor_social",
    angle: "Outdoor play is becoming a better answer to screen-only social games.",
    publicHook: "Same phone. Very different Saturday.",
  },
];

function trendSearchesForCity(city) {
  return [
    `${city} outdoor games`,
    `${city} social sports`,
    `${city} location based game`,
    `${city} live action game experience`,
    `${city} mobile game event`,
    "location based AR game UK",
  ];
}

const FALLBACK_EVENTS = [
  {
    id: "fallback-after-school-rush",
    title: "After School Rush",
    plan_note: "Fast turnout, open ground, and plenty of room to make big plays before dark.",
    scheduled_for: nextDateWithTime(2, 17, 30).toISOString(),
    status: "open",
    meeting_point_name: "Victoria Park",
    meeting_point_parent_name: null,
    meeting_point_postcode: "London",
    meeting_point_photo_url: null,
    distance_m: 480,
    registration_count: 0,
    team_member_count: 0,
  },
  {
    id: "fallback-golden-hour-match",
    title: "Golden Hour Match",
    plan_note: "A brighter Friday session with long lanes, quick pivots, and end-of-week momentum.",
    scheduled_for: nextDateWithTime(4, 17, 45).toISOString(),
    status: "open",
    meeting_point_name: "Battersea Park",
    meeting_point_parent_name: null,
    meeting_point_postcode: "London",
    meeting_point_photo_url: null,
    distance_m: 3300,
    registration_count: 0,
    team_member_count: 0,
  },
];

function nextDateWithTime(daysAhead, hour, minute) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG_PATH,
    outDir: DEFAULT_OUT_DIR,
    offline: false,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--offline") args.offline = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--config") args.config = path.resolve(argv[++i]);
    else if (arg === "--out") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--city") args.city = argv[++i];
    else if (arg === "--lat") args.lat = Number(argv[++i]);
    else if (arg === "--lng") args.lng = Number(argv[++i]);
    else if (arg === "--radius-km") args.radiusKm = Number(argv[++i]);
    else if (arg === "--help") args.help = true;
  }

  return args;
}

function printHelp() {
  console.log(`Triangulate social content agent

Usage:
  npm run social:queue
  node scripts/social_content_agent.mjs --offline
  node scripts/social_content_agent.mjs --city London --lat 51.5074 --lng -0.1278

Options:
  --config <path>     Config JSON path. Defaults to social-agent/config.example.json
  --out <path>        Output directory. Defaults to social-agent/out
  --offline           Do not fetch live events or news signals; use safe samples
  --dry-run           Print summary without writing output files
  --city <name>       Override city label
  --lat <number>      Override event search latitude
  --lng <number>      Override event search longitude
  --radius-km <num>   Override event search radius
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    result[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return result;
}

function readLiveSiteConfig() {
  const localPath = path.resolve(ROOT, "scripts/site-config.js");
  const siblingPath = path.resolve(ROOT, "../triangulate-live-site/scripts/site-config.js");
  const filePath = fs.existsSync(localPath) ? localPath : siblingPath;
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const url = content.match(/SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
  const key = content.match(/SUPABASE_KEY\s*=\s*\n?\s*["']([^"']+)["']/)?.[1];
  return {
    EXPO_PUBLIC_SUPABASE_URL: url,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
  };
}

function resolveSupabaseConfig() {
  const envFile = readEnvFile(path.join(ROOT, ".env"));
  const liveSiteConfig = readLiveSiteConfig();
  const url =
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    envFile.EXPO_PUBLIC_SUPABASE_URL ||
    envFile.SUPABASE_URL ||
    liveSiteConfig.EXPO_PUBLIC_SUPABASE_URL;
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    envFile.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    envFile.SUPABASE_ANON_KEY ||
    liveSiteConfig.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return { url, key };
}

async function fetchEvents(config, args) {
  if (args.offline) return { events: FALLBACK_EVENTS, source: "offline_fallback" };

  const { url, key } = resolveSupabaseConfig();
  if (!url || !key) {
    return { events: FALLBACK_EVENTS, source: "offline_missing_supabase_config" };
  }

  const payload = {
    p_lat: config.location.lat,
    p_lng: config.location.lng,
    p_radius_km: config.location.radiusKm,
    p_limit: 50,
  };

  const res = await fetch(`${url}/rest/v1/rpc/list_public_events_near`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => "");
    return {
      events: FALLBACK_EVENTS,
      source: `offline_fetch_failed_${res.status}`,
      warning: message.slice(0, 240),
    };
  }

  const rows = await res.json();
  const publicEvents = Array.isArray(rows)
    ? rows.filter((event) => event.status === "open" && !event.cancelled_at)
    : [];

  return {
    events: publicEvents.length ? publicEvents : FALLBACK_EVENTS,
    source: publicEvents.length ? "supabase_live_events" : "offline_no_live_events",
  };
}

function decodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanNewsTitle(title) {
  return decodeXmlEntities(title)
    .replace(/\s+-\s+[^-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function signalFromTitle(title) {
  const lower = title.toLowerCase();
  if (/(location|gps|geospatial|map|maps|ar|xr|mixed reality|augmented)/.test(lower)) {
    return {
      key: "map_as_game_board",
      angle: "Current game talk keeps circling back to maps, places, and real-world context.",
      publicHook: "The map is not the menu. The map is the match.",
    };
  }
  if (/(co-op|coop|multiplayer|proximity|team|squad|party|voice)/.test(lower)) {
    return {
      key: "co_op_presence",
      angle: "Co-op and multiplayer games are leaning into shared presence and team moments.",
      publicHook: "Your team should feel close because they actually are.",
    };
  }
  if (/(mobile|free-to-play|test|limited|drop|launch|short)/.test(lower)) {
    return {
      key: "fast_mobile_sessions",
      angle: "Mobile game launches and tests are rewarding ideas that are quick to understand.",
      publicHook: "If the idea is good, people should feel it in the first minute.",
    };
  }
  if (/(live|venue|immersive|experience|outdoor|walking|fitness|hunt)/.test(lower)) {
    return {
      key: "real_world_play",
      angle: "Live and location-aware play keeps pushing games out of static screens.",
      publicHook: "Some games make more sense once you step outside.",
    };
  }
  if (/(pvp|strategy|faction|territory|battle|raid|capture)/.test(lower)) {
    return {
      key: "team_strategy",
      angle: "Strategy games are more memorable when space, timing, and pressure all matter.",
      publicHook: "Fast helps. Shape wins.",
    };
  }
  return null;
}

function uniqueSignals(signals) {
  const seen = new Set();
  const unique = [];
  for (const signal of signals) {
    if (!signal?.key || seen.has(signal.key)) continue;
    seen.add(signal.key);
    unique.push(signal);
  }
  return unique;
}

async function fetchTrendSignals(config, args) {
  if (args.offline) {
    return {
      source: "offline_fallback",
      signals: FALLBACK_TREND_SIGNALS,
    };
  }

  const titles = [];
  const searches = trendSearchesForCity(config.location.city).map(async (query) => {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", `${query} when:30d`);
    url.searchParams.set("hl", "en-GB");
    url.searchParams.set("gl", "GB");
    url.searchParams.set("ceid", "GB:en");

    const res = await fetch(url, {
      headers: {
        "User-Agent": "TriangulateSocialAgent/1.0",
      },
    });
    if (!res.ok) return;

    const xml = await res.text();
    for (const match of xml.matchAll(/<title>([\s\S]*?)<\/title>/g)) {
      const title = cleanNewsTitle(match[1]);
      if (title && title !== "Google News") titles.push(title);
    }
  });

  const results = await Promise.allSettled(searches);
  const hadSuccessfulFetch = results.some((result) => result.status === "fulfilled");
  const currentSignals = uniqueSignals(titles.map(signalFromTitle).filter(Boolean));

  return {
    source: hadSuccessfulFetch && currentSignals.length ? "current_news_inspired" : "fallback_no_trend_matches",
    signals: currentSignals.length ? currentSignals.concat(FALLBACK_TREND_SIGNALS) : FALLBACK_TREND_SIGNALS,
    titleCount: titles.length,
  };
}

function normaliseConfig(config, args) {
  const next = structuredClone(config);
  if (args.city) next.location.city = args.city;
  if (Number.isFinite(args.lat)) next.location.lat = args.lat;
  if (Number.isFinite(args.lng)) next.location.lng = args.lng;
  if (Number.isFinite(args.radiusKm)) next.location.radiusKm = args.radiusKm;
  return next;
}

function placeLabel(event) {
  const child = event.meeting_point_name || "the venue";
  const parent = event.meeting_point_parent_name;
  return parent ? `${parent} · ${child}` : child;
}

function formatWhen(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "soon";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function triggerForEvent(event) {
  const scheduled = new Date(event.scheduled_for).getTime();
  const now = Date.now();
  if (Number.isNaN(scheduled)) return "event_announcement";
  const hours = (scheduled - now) / 36e5;
  if (hours < -2) return "event_recap";
  if (hours <= 3 && hours >= -2) return "starting_soon";
  if (hours <= 24) return "t_minus_24h";
  if (hours <= 72) return "t_minus_72h";
  return "event_announcement";
}

function eventAngle(event, city) {
  const venue = placeLabel(event);
  const note = (event.plan_note || "").trim();
  if (note) return note;
  return `${venue} becomes a live triangle-game space for ${city}.`;
}

function eventHashtag(event) {
  const name = String(event.title || "Event")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `#Triangulate${name || "Event"}`;
}

function eventUrlFor(event, config) {
  const eventId = String(event.id || "").trim();
  if (!eventId) return "";
  if (eventId.startsWith("fallback-")) return "";

  try {
    const url = new URL(config.brand.eventsUrl);
    url.searchParams.set("event", eventId);
    return url.toString();
  } catch {
    const separator = config.brand.eventsUrl.includes("?") ? "&" : "?";
    return `${config.brand.eventsUrl}${separator}event=${encodeURIComponent(eventId)}`;
  }
}

function dayKey(isoString) {
  return new Date(isoString).toISOString().slice(0, 10);
}

function stableHash(value) {
  let hash = 0;
  for (const char of String(value)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function rotateList(items, seed) {
  if (!items.length) return [];
  const offset = seed % items.length;
  return items.slice(offset).concat(items.slice(0, offset));
}

function geoTargetingFor(config) {
  return {
    type: "platform_location_targeting_guidance",
    rule: "Use local copy only for geo-targeted placements. Use fallback copy for general organic posting.",
    city: config.location.city,
    lat: config.location.lat,
    lng: config.location.lng,
    radiusKm: config.location.radiusKm,
    audience: `Instagram/TikTok users whose platform location signals place them in or near ${config.location.city}.`,
    privacy: "Do not infer, store, or expose any individual user's location.",
  };
}

function fallbackCopy(hook, caption, hashtags, notes = []) {
  return {
    useWhen: "Use this for organic posts or audiences without platform location targeting.",
    hook,
    caption,
    hashtags,
    notes,
  };
}

function buildGeneralMarketingDrafts(config, trendResult, generatedAt) {
  const city = config.location.city;
  const geoTargeting = geoTargetingFor(config);
  const targetCount = config.cadence.dailyGeneralPostTarget || 5;
  const signals = uniqueSignals(trendResult.signals || FALLBACK_TREND_SIGNALS);
  const rotatedSignals = rotateList(signals, stableHash(`${dayKey(generatedAt)}:${city}`));
  const signalAt = (index) => rotatedSignals[index % rotatedSignals.length] || FALLBACK_TREND_SIGNALS[index % FALLBACK_TREND_SIGNALS.length];

  const drafts = [
    {
      status: "needs_approval",
      safety: "general_marketing_no_source_mentions_no_player_data",
      trigger: "daily_general_marketing",
      trendSignalKey: signalAt(0).key,
      locality: city,
      geoTargeting,
      channel: "tiktok",
      format: "9:16 short video",
      title: `${city} is playable`,
      hook: `${city} has more playable space than people think.`,
      marketingAngle: signalAt(0).angle,
      script: [
        `Text: ${city} is not just where the game happens.`,
        "Text: The streets, parks, and open routes change the strategy.",
        "VO: Three players. One moving triangle. Real-world decisions.",
        `VO: Find the next Triangulate session: ${config.brand.eventsUrl}.`,
      ],
      caption: `${city} has parks, routes, corners, and sightlines. Triangulate turns them into a team game. ${config.brand.eventsUrl}`,
      hashtags: ["#PlayTriangulate", `#${city.replace(/\s+/g, "")}Events`, "#OutdoorMultiplayer", "#MobileGameIRL"],
      fallbackCopy: fallbackCopy(
        "The best game board might already be outside.",
        `Parks, routes, corners, and sightlines can become a team game. Triangulate turns real space into play. ${config.brand.eventsUrl}`,
        ["#PlayTriangulate", "#OutdoorMultiplayer", "#MobileGameIRL"],
        ["Replace the city-specific opening text with: The real world is playable."]
      ),
      assetBrief: `Fast cuts of ${city}-style streets, parks, and map lines. No identifiable faces. Use bold captions and a glowing triangle moving through local space.`,
    },
    {
      status: "needs_approval",
      safety: "general_marketing_no_source_mentions_no_player_data",
      trigger: "daily_general_marketing",
      trendSignalKey: signalAt(1).key,
      locality: city,
      geoTargeting,
      channel: "instagram_reel",
      format: "9:16 reel",
      title: "The group chat can leave the chat",
      hook: "Some games are better when everyone has to actually move.",
      marketingAngle: signalAt(1).angle,
      script: [
        "Text: The group chat can leave the chat.",
        `Text: Pick a public space in ${city}.`,
        "Text: Form a triangle. Hold the shape. Outthink nearby teams.",
        "Text: Triangulate is real-world team play.",
      ],
      caption: `A mobile game for people who want the plan, the sprint, and the laugh afterwards. Built for real spaces around ${city}. ${config.brand.eventsUrl}`,
      hashtags: ["#PlayTriangulate", "#SocialSports", "#OutdoorGames", `#${city.replace(/\s+/g, "")}`],
      fallbackCopy: fallbackCopy(
        "Some games are better when everyone has to actually move.",
        `A mobile game for people who want the plan, the sprint, and the laugh afterwards. Built for real spaces, not just screens. ${config.brand.eventsUrl}`,
        ["#PlayTriangulate", "#SocialSports", "#OutdoorGames"],
        ["Replace the city-specific script line with: Pick a public space nearby."]
      ),
      assetBrief: `Create a local-feeling reel: phone close-up, shoes on pavement, simple triangle graphic over a ${city} park/square scene. No real player identities.`,
    },
    {
      status: "needs_approval",
      safety: "general_marketing_no_source_mentions_no_player_data",
      trigger: "daily_general_marketing",
      trendSignalKey: signalAt(2).key,
      locality: city,
      geoTargeting,
      channel: "instagram_carousel",
      format: "5-slide carousel",
      title: `Why ${city} works as a game board`,
      marketingAngle: signalAt(2).angle,
      slides: [
        `${city} already has the map.`,
        "Parks create open lanes.",
        "Corners create decisions.",
        "Distance creates team pressure.",
        `Triangulate turns all of it into play: ${config.brand.eventsUrl}`,
      ],
      caption: `The best game board might already be outside. Triangulate is built around real routes, real spacing, and team decisions in ${city}.`,
      hashtags: ["#PlayTriangulate", "#RealWorldGaming", "#TriangleTactics", `#${city.replace(/\s+/g, "")}Life`],
      fallbackCopy: fallbackCopy(
        "Why real spaces work as a game board",
        "The best game board might already be outside. Triangulate is built around real routes, real spacing, and team decisions.",
        ["#PlayTriangulate", "#RealWorldGaming", "#TriangleTactics"],
        ["Replace the first carousel slide with: The real world already has the map."]
      ),
      assetBrief: `Bold diagram carousel using abstract ${city} map shapes, triangle overlays, arrows, and short tactical captions.`,
    },
    {
      status: "needs_approval",
      safety: "general_marketing_no_source_mentions_no_player_data",
      trigger: "daily_general_marketing",
      trendSignalKey: signalAt(3).key,
      locality: city,
      geoTargeting,
      channel: "tiktok",
      format: "9:16 short video",
      title: "Fast helps. Shape wins.",
      hook: "In Triangulate, speed is useful. Positioning is everything.",
      marketingAngle: signalAt(3).angle,
      script: [
        "Scene: Three dots spread across a local map.",
        "Text: Fast helps.",
        "Scene: Triangle expands and pivots.",
        "Text: Shape wins.",
        `Text: Try it around ${city}.`,
      ],
      caption: `This is not just running around with a phone. It is spacing, timing, and team shape. ${config.brand.eventsUrl}`,
      hashtags: ["#PlayTriangulate", "#TriangleTactics", "#RunClaimSurvive", "#TeamStrategy"],
      fallbackCopy: fallbackCopy(
        "In Triangulate, speed is useful. Positioning is everything.",
        `This is not just running around with a phone. It is spacing, timing, and team shape. ${config.brand.eventsUrl}`,
        ["#PlayTriangulate", "#TriangleTactics", "#RunClaimSurvive", "#TeamStrategy"],
        ["Replace the final text card with: Try it outside."]
      ),
      assetBrief: `Make a punchy tactical explainer with animated dots, a triangle outline, and local map texture inspired by ${city}.`,
    },
    {
      status: "needs_approval",
      safety: "general_marketing_no_source_mentions_no_player_data",
      trigger: "daily_general_marketing",
      trendSignalKey: signalAt(4).key,
      locality: city,
      geoTargeting,
      channel: "instagram_story",
      format: "4 story frames",
      title: `${city} weekend prompt`,
      marketingAngle: signalAt(4).angle,
      frames: [
        `This weekend in ${city}: try a game that uses the actual map.`,
        "Bring two people.",
        "Form one triangle.",
        `Find or start a session: ${config.brand.eventsUrl}`,
      ],
      hashtags: ["#PlayTriangulate", "#OutdoorMultiplayer", `#${city.replace(/\s+/g, "")}Events`],
      fallbackCopy: fallbackCopy(
        "This weekend: try a game that uses the actual map.",
        `Bring two people. Form one triangle. Find or start a session: ${config.brand.eventsUrl}`,
        ["#PlayTriangulate", "#OutdoorMultiplayer", "#MobileGameIRL"],
        ["Replace the first story frame with: This weekend: try a game that uses the actual map."]
      ),
      assetBrief: `Four story frames with local weekend energy, triangle route lines, and simple call-to-action copy. No news/source references.`,
    },
    {
      status: "needs_approval",
      safety: "general_marketing_no_source_mentions_no_player_data",
      trigger: "daily_general_marketing",
      trendSignalKey: signalAt(5).key,
      locality: city,
      geoTargeting,
      channel: "instagram_reel",
      format: "9:16 reel",
      title: "A mobile game with fresh air",
      hook: "Same phone. Different kind of session.",
      marketingAngle: signalAt(5).angle,
      script: [
        "Text: Mobile game?",
        "Text: Yes.",
        "Text: Sitting still?",
        "Text: Not this one.",
        `Text: Triangulate is built for real spaces around ${city}.`,
      ],
      caption: `A phone game that gives the group a reason to meet outside. ${config.brand.eventsUrl}`,
      hashtags: ["#PlayTriangulate", "#MobileGameIRL", "#OutdoorGames", "#SocialGaming"],
      fallbackCopy: fallbackCopy(
        "Same phone. Different kind of session.",
        `A phone game that gives the group a reason to meet outside. ${config.brand.eventsUrl}`,
        ["#PlayTriangulate", "#MobileGameIRL", "#OutdoorGames", "#SocialGaming"],
        ["Replace the final script line with: Triangulate is built for real spaces."]
      ),
      assetBrief: `Use upbeat outdoor footage style, map UI fragments, and a clean triangle motif. Keep it local to ${city} without showing identifiable people.`,
    },
  ];

  return rotateList(drafts, stableHash(`${city}:${dayKey(generatedAt)}:general`)).slice(0, targetCount);
}

function buildOwnedDrafts(events, config, trendResult, generatedAt) {
  const city = config.location.city;
  const eventDrafts = events.slice(0, 6).flatMap((event) => {
    const venue = placeLabel(event);
    const when = formatWhen(event.scheduled_for);
    const trigger = triggerForEvent(event);
    const angle = eventAngle(event, city);
    const uniqueTag = eventHashtag(event);
    const baseTags = ["#PlayTriangulate", "#TriangulateLive", "#RunClaimSurvive", uniqueTag];
    const eventUrl = eventUrlFor(event, config);
    const actionUrl = eventUrl || config.brand.eventsUrl;
    const eventCta = eventUrl ? `Open this event: ${actionUrl}` : `Find it on ${actionUrl}`;
    const reelCta = eventUrl ? "Open the linked event on Triangulate." : "Join the event on Triangulate.";

    return [
      {
        status: "needs_approval",
        safety: "event_level_only_no_player_mentions",
        trigger,
        sourceEventId: event.id,
        ...(eventUrl ? { eventUrl } : {}),
        channel: "tiktok",
        format: "9:16 short video",
        title: `${event.title}: ${venue}`,
        hook: `${venue} is not just a place today. It is a Triangulate field.`,
        script: [
          `Show a map-style triangle over ${venue}.`,
          `VO: ${event.title} lands ${when}.`,
          "VO: Three points, one moving shape, and a match that only works outdoors.",
          `VO: ${eventCta}.`,
        ],
        caption: `${event.title} at ${venue}. Three points. One triangle. Real-world play. ${actionUrl}`,
        hashtags: baseTags,
        assetBrief: `Create a 9:16 animated triangle-map visual for ${venue}. No real player faces. Use cyan/gold triangle lines and bold captions.`,
      },
      {
        status: "needs_approval",
        safety: "event_level_only_no_player_mentions",
        trigger,
        sourceEventId: event.id,
        ...(eventUrl ? { eventUrl } : {}),
        channel: "instagram_reel",
        format: "9:16 reel",
        title: `${event.title} reel`,
        hook: `A real-world strategy game is coming to ${venue}.`,
        script: [
          `Text: ${event.title}`,
          `Text: ${venue} · ${when}`,
          `Text: ${angle}`,
          `Text: ${reelCta}`,
        ],
        caption: `${event.title} at ${venue}. ${angle} ${actionUrl}`,
        hashtags: baseTags.concat([`#${city.replace(/\s+/g, "")}Events`]),
        assetBrief: `Use the website's outdoor multiplayer style: real city/park energy, glowing triangle motif, no identifiable players.`,
      },
      {
        status: "needs_approval",
        safety: "event_level_only_no_player_mentions",
        trigger,
        sourceEventId: event.id,
        ...(eventUrl ? { eventUrl } : {}),
        channel: "instagram_story",
        format: "4 story frames",
        title: `${event.title} story reminder`,
        frames: [
          `Today/soon: ${event.title}`,
          `Venue: ${venue}`,
          "How it works: three points form one live triangle.",
          eventCta,
        ],
        hashtags: ["#PlayTriangulate", uniqueTag],
        assetBrief: "Create four simple story frames with countdown energy and no player names.",
      },
    ];
  });

  const evergreenDrafts = [
    {
      status: "needs_approval",
      safety: "owned_content_no_player_data",
      trigger: "evergreen_explainer",
      channel: "tiktok",
      format: "9:16 short video",
      title: "What is Triangulate?",
      hook: "This is a mobile game, but the map is real.",
      script: [
        "Scene 1: Three points appear over a park.",
        "VO: Three people form one triangle.",
        "Scene 2: The triangle stretches across paths.",
        "VO: You move together, hold the shape, and outplay nearby teams.",
        `Scene 3: Events page at ${config.brand.eventsUrl}.`,
      ],
      caption: "Three points. One triangle. Real-world play.",
      hashtags: ["#PlayTriangulate", "#OutdoorMultiplayer", "#RunClaimSurvive", "#MobileGameIRL"],
      assetBrief: "Fast rule explainer with animated triangle lines and map-style captions.",
    },
    {
      status: "needs_approval",
      safety: "owned_content_no_player_data",
      trigger: "evergreen_tactic",
      channel: "instagram_carousel",
      format: "5-slide carousel",
      title: "How the triangle works",
      slides: [
        "Three points. One triangle.",
        "Join an event or start one nearby.",
        "Spread out with your team.",
        "Bigger, smarter triangles beat smaller ones.",
        `Find the next event: ${config.brand.eventsUrl}`,
      ],
      caption: "Easy to explain. Hard to play well.",
      hashtags: ["#PlayTriangulate", "#TriangleTactics", "#OutdoorGames", "#RealWorldGaming"],
      assetBrief: "Bold carousel with simple diagrams and large captions.",
    },
  ];

  const eventTarget = Math.max(0, config.cadence.dailyOwnedPostTarget || 4);
  const generalDrafts = buildGeneralMarketingDrafts(config, trendResult, generatedAt);
  return eventDrafts.slice(0, eventTarget).concat(generalDrafts, evergreenDrafts);
}

function buildLeadSuggestions(events, config) {
  const city = config.location.city;
  const eventSummaries = events
    .map((event) => ({
      name: event.title,
      url: eventUrlFor(event, config),
      fallbackUrl: config.brand.eventsUrl,
      venue: placeLabel(event),
    }))
    .filter((event) => event.name);
  const leadTargets = config.leadTargets || [];
  const targetCount = config.cadence.leadSuggestionTarget || 12;

  const baseSuggestions = leadTargets.flatMap((target) => [
    {
      status: "needs_manual_review",
      actionAllowed: "research_only",
      platform: "instagram",
      searchQuery: `${city} ${target}`,
      reason: `Find ${target} accounts/events that overlap with outdoor social play.`,
      suggestedComment: `This looks like the kind of group that would understand Triangulate: three points, one team shape, real movement. Events are listed at ${config.brand.eventsUrl}.`,
    },
    {
      status: "needs_manual_review",
      actionAllowed: "research_only",
      platform: "tiktok",
      searchQuery: `${city} ${target} outdoor game`,
      reason: `Find short-form content where a Triangulate event reference would be genuinely relevant.`,
      suggestedComment: `This has real Triangulate energy: open space, quick decisions, and a game that only works outdoors. ${config.brand.eventsUrl}`,
    },
  ]);

  const eventSuggestions = eventSummaries.slice(0, 4).map((event) => ({
    status: "needs_manual_review",
    actionAllowed: "comment_suggestion_only",
    platform: "instagram",
    searchQuery: `${city} events this week outdoor games`,
    reason: `Use ${event.name} as the relevant Triangulate event hook if the post is about local activities.`,
    suggestedComment: `${event.name} is a Triangulate event built around three-player movement and real-world strategy. Details are here: ${event.url || event.fallbackUrl}.`,
  }));

  const venueSuggestions = eventSummaries.slice(0, 4).map((event) => ({
    status: "needs_manual_review",
    actionAllowed: "comment_suggestion_only",
    platform: "instagram",
    searchQuery: `${event.venue} events`,
    reason: `Find posts about the venue and only comment if Triangulate is genuinely relevant.`,
    suggestedComment: `${event.venue} has strong triangle-game energy: open lanes, good sightlines, and room to reset. This event is here: ${event.url || event.fallbackUrl}.`,
  }));

  return baseSuggestions.concat(eventSuggestions, venueSuggestions).slice(0, targetCount);
}

function buildRun(config, eventsResult, trendResult) {
  const events = eventsResult.events;
  const generatedAt = new Date().toISOString();
  const ownedDrafts = buildOwnedDrafts(events, config, trendResult, generatedAt);
  const leadSuggestions = buildLeadSuggestions(events, config);

  return {
    generatedAt,
    mode: "phase_1_manual_approval",
    accounts: {
      instagram: config.brand.instagram,
      tiktok: config.brand.tiktok,
    },
    safety: {
      autoPosting: false,
      autoComments: false,
      autoLikes: false,
      note: "This run creates drafts and suggestions only. A human must approve and post manually.",
    },
    eventSource: {
      source: eventsResult.source,
      warning: eventsResult.warning || null,
      eventCount: events.length,
    },
    trendSource: {
      source: trendResult.source,
      signalCount: uniqueSignals(trendResult.signals || []).length,
      titleCount: trendResult.titleCount || 0,
      note: "Trend signals inspire general marketing angles only. Public copy must not mention news sources.",
    },
    ownedDrafts,
    leadSuggestions,
  };
}

function markdownForRun(run) {
  const lines = [
    "# Triangulate Social Queue",
    "",
    `Generated: ${run.generatedAt}`,
    `Mode: ${run.mode}`,
    "",
    "Safety:",
    "",
    "- Auto-posting: off",
    "- Auto-comments: off",
    "- Auto-likes: off",
    "- Human approval required before any public action",
    "",
    `Event source: ${run.eventSource.source} (${run.eventSource.eventCount} events)`,
    `Trend source: ${run.trendSource.source} (${run.trendSource.signalCount} signals)`,
    "",
    "## Owned Content Drafts",
    "",
  ];

  run.ownedDrafts.forEach((draft, index) => {
    lines.push(`### ${index + 1}. ${draft.channel}: ${draft.title}`);
    lines.push("");
    lines.push(`- Status: ${draft.status}`);
    lines.push(`- Trigger: ${draft.trigger}`);
    if (draft.sourceEventId) lines.push(`- Source event: ${draft.sourceEventId}`);
    if (draft.eventUrl) lines.push(`- Event link: ${draft.eventUrl}`);
    if (draft.locality) lines.push(`- Locality: ${draft.locality}`);
    if (draft.geoTargeting) {
      lines.push(
        `- Geo targeting: ${draft.geoTargeting.city}, ${draft.geoTargeting.radiusKm}km radius. ${draft.geoTargeting.rule}`
      );
    }
    if (draft.marketingAngle) lines.push(`- Marketing angle: ${draft.marketingAngle}`);
    lines.push(`- Hook: ${draft.hook || "n/a"}`);
    lines.push(`- Caption: ${draft.caption || "n/a"}`);
    lines.push(`- Hashtags: ${(draft.hashtags || []).join(" ")}`);
    if (draft.fallbackCopy) {
      lines.push(`- General fallback hook: ${draft.fallbackCopy.hook}`);
      lines.push(`- General fallback caption: ${draft.fallbackCopy.caption}`);
      lines.push(`- General fallback hashtags: ${(draft.fallbackCopy.hashtags || []).join(" ")}`);
      if (draft.fallbackCopy.notes?.length) {
        lines.push(`- General fallback notes: ${draft.fallbackCopy.notes.join(" ")}`);
      }
    }
    lines.push(`- Asset brief: ${draft.assetBrief || "n/a"}`);
    if (draft.script) {
      lines.push("- Script:");
      draft.script.forEach((step) => lines.push(`  - ${step}`));
    }
    if (draft.frames) {
      lines.push("- Story frames:");
      draft.frames.forEach((frame) => lines.push(`  - ${frame}`));
    }
    if (draft.slides) {
      lines.push("- Slides:");
      draft.slides.forEach((slide) => lines.push(`  - ${slide}`));
    }
    lines.push("");
  });

  lines.push("## Lead And Comment Suggestions", "");
  run.leadSuggestions.forEach((lead, index) => {
    lines.push(`### ${index + 1}. ${lead.platform}: ${lead.searchQuery}`);
    lines.push("");
    lines.push(`- Status: ${lead.status}`);
    lines.push(`- Allowed action: ${lead.actionAllowed}`);
    lines.push(`- Reason: ${lead.reason}`);
    lines.push(`- Suggested comment: ${lead.suggestedComment}`);
    lines.push("");
  });

  return lines.join("\n");
}

function writeRun(run, outDir, dryRun) {
  if (dryRun) return { jsonPath: null, markdownPath: null };
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date(run.generatedAt).toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `social-queue-${stamp}.json`);
  const markdownPath = path.join(outDir, `social-queue-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
  fs.writeFileSync(markdownPath, `${markdownForRun(run)}\n`);
  return { jsonPath, markdownPath };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const rawConfig = readJson(args.config);
  const config = normaliseConfig(rawConfig, args);
  const [eventsResult, trendResult] = await Promise.all([
    fetchEvents(config, args),
    fetchTrendSignals(config, args),
  ]);
  const run = buildRun(config, eventsResult, trendResult);
  const paths = writeRun(run, args.outDir, args.dryRun);

  console.log("Triangulate social agent complete");
  console.log(`Mode: ${run.mode}`);
  console.log(`Event source: ${run.eventSource.source}`);
  console.log(`Trend source: ${run.trendSource.source}`);
  console.log(`Owned drafts: ${run.ownedDrafts.length}`);
  console.log(`Lead/comment suggestions: ${run.leadSuggestions.length}`);
  console.log("Auto-posting: off");
  console.log("Auto-comments: off");
  console.log("Auto-likes: off");
  if (paths.markdownPath) console.log(`Review queue: ${paths.markdownPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
