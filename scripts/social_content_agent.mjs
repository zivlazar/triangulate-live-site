#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_CONFIG_PATH = path.join(ROOT, "social-agent", "config.example.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "social-agent", "out");
const VIEWER_ID = "social-agent-public-viewer";

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
  --offline           Do not fetch live events; use safe sample event ideas
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
    p_viewer_id: VIEWER_ID,
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

function buildOwnedDrafts(events, config) {
  const city = config.location.city;
  const eventDrafts = events.slice(0, 6).flatMap((event) => {
    const venue = placeLabel(event);
    const when = formatWhen(event.scheduled_for);
    const trigger = triggerForEvent(event);
    const angle = eventAngle(event, city);
    const uniqueTag = eventHashtag(event);
    const baseTags = ["#PlayTriangulate", "#TriangulateLive", "#RunClaimSurvive", uniqueTag];

    return [
      {
        status: "needs_approval",
        safety: "event_level_only_no_player_mentions",
        trigger,
        sourceEventId: event.id,
        channel: "tiktok",
        format: "9:16 short video",
        title: `${event.title}: ${venue}`,
        hook: `${venue} is not just a place today. It is a Triangulate field.`,
        script: [
          `Show a map-style triangle over ${venue}.`,
          `VO: ${event.title} lands ${when}.`,
          "VO: Three points, one moving shape, and a match that only works outdoors.",
          `VO: Find it on ${config.brand.eventsUrl}.`,
        ],
        caption: `${event.title} at ${venue}. Three points. One triangle. Real-world play.`,
        hashtags: baseTags,
        assetBrief: `Create a 9:16 animated triangle-map visual for ${venue}. No real player faces. Use cyan/gold triangle lines and bold captions.`,
      },
      {
        status: "needs_approval",
        safety: "event_level_only_no_player_mentions",
        trigger,
        sourceEventId: event.id,
        channel: "instagram_reel",
        format: "9:16 reel",
        title: `${event.title} reel`,
        hook: `A real-world strategy game is coming to ${venue}.`,
        script: [
          `Text: ${event.title}`,
          `Text: ${venue} · ${when}`,
          `Text: ${angle}`,
          "Text: Join the event on Triangulate.",
        ],
        caption: `${event.title} at ${venue}. ${angle} ${config.brand.eventsUrl}`,
        hashtags: baseTags.concat([`#${city.replace(/\s+/g, "")}Events`]),
        assetBrief: `Use the website's outdoor multiplayer style: real city/park energy, glowing triangle motif, no identifiable players.`,
      },
      {
        status: "needs_approval",
        safety: "event_level_only_no_player_mentions",
        trigger,
        sourceEventId: event.id,
        channel: "instagram_story",
        format: "4 story frames",
        title: `${event.title} story reminder`,
        frames: [
          `Today/soon: ${event.title}`,
          `Venue: ${venue}`,
          "How it works: three points form one live triangle.",
          `Open the events page: ${config.brand.eventsUrl}`,
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

  return eventDrafts.concat(evergreenDrafts).slice(0, Math.max(4, config.cadence.dailyOwnedPostTarget * 2));
}

function buildLeadSuggestions(events, config) {
  const city = config.location.city;
  const eventNames = events.map((event) => event.title).filter(Boolean);
  const venues = events.map(placeLabel).filter(Boolean);
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

  const eventSuggestions = eventNames.slice(0, 4).map((name) => ({
    status: "needs_manual_review",
    actionAllowed: "comment_suggestion_only",
    platform: "instagram",
    searchQuery: `${city} events this week outdoor games`,
    reason: `Use ${name} as the relevant Triangulate event hook if the post is about local activities.`,
    suggestedComment: `${name} is a Triangulate event built around three-player movement and real-world strategy. Details are on ${config.brand.eventsUrl}.`,
  }));

  const venueSuggestions = venues.slice(0, 4).map((venue) => ({
    status: "needs_manual_review",
    actionAllowed: "comment_suggestion_only",
    platform: "instagram",
    searchQuery: `${venue} events`,
    reason: `Find posts about the venue and only comment if Triangulate is genuinely relevant.`,
    suggestedComment: `${venue} has strong triangle-game energy: open lanes, good sightlines, and room to reset. Triangulate events are at ${config.brand.eventsUrl}.`,
  }));

  return baseSuggestions.concat(eventSuggestions, venueSuggestions).slice(0, targetCount);
}

function buildRun(config, eventsResult) {
  const events = eventsResult.events;
  const generatedAt = new Date().toISOString();
  const ownedDrafts = buildOwnedDrafts(events, config);
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
    "",
    "## Owned Content Drafts",
    "",
  ];

  run.ownedDrafts.forEach((draft, index) => {
    lines.push(`### ${index + 1}. ${draft.channel}: ${draft.title}`);
    lines.push("");
    lines.push(`- Status: ${draft.status}`);
    lines.push(`- Trigger: ${draft.trigger}`);
    lines.push(`- Hook: ${draft.hook || "n/a"}`);
    lines.push(`- Caption: ${draft.caption || "n/a"}`);
    lines.push(`- Hashtags: ${(draft.hashtags || []).join(" ")}`);
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
  const eventsResult = await fetchEvents(config, args);
  const run = buildRun(config, eventsResult);
  const paths = writeRun(run, args.outDir, args.dryRun);

  console.log("Triangulate social agent complete");
  console.log(`Mode: ${run.mode}`);
  console.log(`Event source: ${run.eventSource.source}`);
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
