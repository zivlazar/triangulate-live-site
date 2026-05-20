// admin-game-bridge
//
// Thin proxy between the /admin-events.html portal (live-site project)
// and the Triangulate game backend (game project, rgczribfoutvpashjgrx).
//
// Two responsibilities:
//   1. Verify the caller's live-site magic-link JWT belongs to a row in
//      public.admin_users on the live-site project. Anyone not on the
//      allowlist is rejected before any game-project traffic is made.
//   2. For the verified admin, execute one of a fixed set of actions
//      against the game project: list events, approve, reject,
//      approve-all, cancel, fetch a single event's roster + attendees.
//
// Why a bridge instead of letting the browser hit the game project
// directly? The game's admin RPCs (approve_event, reject_event,
// approve_all_pending_events, cancel_event) all take a player_id
// argument and check public.is_admin_player(player_id) which means
// the caller must declare which player-profile they are. We don't
// want that player_id in the browser (it would let any signed-in
// admin claim any player_id), so the bridge supplies it server-side
// from the GAME_ADMIN_PLAYER_ID env var.
//
// All keys (game anon key, admin player_id) stay on the edge runtime.

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

// ─── Step 1: verify caller is on the live-site admin allowlist ──────────

async function requireAdminEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  const liveUrl = env("SUPABASE_URL");
  const liveAnon = env("SUPABASE_ANON_KEY");
  if (!liveUrl || !liveAnon || !token) return null;

  const userRes = await fetch(`${liveUrl}/auth/v1/user`, {
    headers: { apikey: liveAnon, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  const email = String(user?.email || "").toLowerCase();
  if (!email) return null;

  const adminRes = await fetch(
    `${liveUrl}/rest/v1/admin_users?email=eq.${encodeURIComponent(email)}&select=email`,
    { headers: { apikey: liveAnon, Authorization: `Bearer ${token}` } },
  );
  if (!adminRes.ok) return null;
  const rows = await adminRes.json();
  return Array.isArray(rows) && rows.length ? email : null;
}

// ─── Step 2: helpers for game-project access ────────────────────────────

const gameUrl = () => env("GAME_SUPABASE_URL");
const gameAnon = () => env("GAME_SUPABASE_ANON_KEY");
const adminPlayerId = () => env("GAME_ADMIN_PLAYER_ID");

async function gameRest(path: string, init: RequestInit = {}) {
  const url = `${gameUrl()}/rest/v1/${path}`;
  const headers = {
    apikey: gameAnon(),
    Authorization: `Bearer ${gameAnon()}`,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    throw new Error(`game ${path} HTTP ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function gameRpc(fn: string, args: Record<string, unknown>) {
  return gameRest(`rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

// ─── Action handlers ────────────────────────────────────────────────────

async function listEvents() {
  // The game's list_public_events_near returns rows visible to the
  // viewer. Passing the admin player_id lifts the radius gate and
  // exposes pending + rejected events alongside the public ones.
  // London centroid + 50,000 km radius covers the whole planet for
  // the admin's view.
  const rows = await gameRpc("list_public_events_near", {
    p_lat: 51.5074,
    p_lng: -0.1278,
    p_viewer_id: adminPlayerId(),
    p_radius_km: 50000,
    p_limit: 500,
  });
  return rows;
}

async function listEventDetail(eventId: string) {
  // Pull the event row, its RSVPs, and any auto-detected attendees.
  // Three reads in parallel.
  const [eventRows, registrations, attendees, teamMembers] = await Promise.all([
    gameRest(`events?id=eq.${encodeURIComponent(eventId)}&select=*`),
    gameRest(`event_registrations?event_id=eq.${encodeURIComponent(eventId)}&select=*,player_profiles!inner(nickname,color)`),
    gameRest(`event_attendees?event_id=eq.${encodeURIComponent(eventId)}&select=*,player_profiles!inner(nickname,color)`),
    gameRest(`event_team_members?event_id=eq.${encodeURIComponent(eventId)}&select=*,player_profiles!inner(nickname,color)`),
  ]);
  const event = Array.isArray(eventRows) && eventRows.length ? eventRows[0] : null;
  return { event, registrations, attendees, team_members: teamMembers };
}

async function approveEvent(eventId: string) {
  const count = await gameRpc("approve_event", {
    p_event_id: eventId,
    p_admin_id: adminPlayerId(),
  });
  return { approved: count };
}

async function rejectEvent(eventId: string) {
  const count = await gameRpc("reject_event", {
    p_event_id: eventId,
    p_admin_id: adminPlayerId(),
  });
  return { rejected: count };
}

async function approveAll() {
  const count = await gameRpc("approve_all_pending_events", {
    p_admin_id: adminPlayerId(),
  });
  return { approved: count };
}

async function cancelEvent(eventId: string) {
  // Cancel from the admin player_id. Only the creator can cancel per the
  // game's RPC, so this WILL fail unless the admin created the event.
  // For now this surfaces the game's own error message verbatim.
  await gameRpc("cancel_event", {
    p_event_id: eventId,
    p_user_id: adminPlayerId(),
  });
  return { ok: true };
}

async function meetingPoints() {
  // For the New Event form: list active meeting points so the admin
  // can attach an event to a real venue. Limit conservative.
  return gameRest(
    "meeting_points?is_active=eq.true&select=id,name,city,postcode,address&order=city.asc,name.asc&limit=200",
  );
}

// ─── Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const adminEmail = await requireAdminEmail(req);
  if (!adminEmail) return json({ error: "Forbidden" }, 403);

  if (!gameUrl() || !gameAnon() || !adminPlayerId()) {
    return json({ error: "Bridge is not configured. Missing GAME_SUPABASE_URL / GAME_SUPABASE_ANON_KEY / GAME_ADMIN_PLAYER_ID." }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* allow empty body */ }

  const action = String(body?.action || "");
  const eventId = body?.event_id ? String(body.event_id) : "";

  try {
    switch (action) {
      case "list_events":
        return json({ ok: true, events: await listEvents() });
      case "event_detail":
        if (!eventId) return json({ error: "event_id required" }, 400);
        return json({ ok: true, ...(await listEventDetail(eventId)) });
      case "approve":
        if (!eventId) return json({ error: "event_id required" }, 400);
        return json({ ok: true, ...(await approveEvent(eventId)) });
      case "reject":
        if (!eventId) return json({ error: "event_id required" }, 400);
        return json({ ok: true, ...(await rejectEvent(eventId)) });
      case "approve_all":
        return json({ ok: true, ...(await approveAll()) });
      case "cancel":
        if (!eventId) return json({ error: "event_id required" }, 400);
        return json({ ok: true, ...(await cancelEvent(eventId)) });
      case "meeting_points":
        return json({ ok: true, meeting_points: await meetingPoints() });
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : "Bridge failure",
      action,
      requested_by: adminEmail,
    }, 500);
  }
});
