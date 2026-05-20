import "./site-core.js";
import { SUPABASE_KEY, SUPABASE_URL } from "./site-config.js";

// Admin event-management portal — thin client over the Triangulate game
// backend (project rgczribfoutvpashjgrx). All data reads + mutations
// flow through the live-site `admin-game-bridge` edge function, which
// verifies the caller is on the live-site admin allowlist (admin_users
// table) before proxying to the game project's anon-callable RPCs.
//
// No event/registration/team data lives in the live-site database.
// Whatever the game enforces (status transitions, +4h attendance window,
// 1-day lead time, 3/24h creation cap, 50km geofence, venue conflict
// guard, auto-reject/auto-delete crons) automatically applies here.

const ACCESS_TOKEN_KEY = "triangulate_event_admin_access_token";
const BRIDGE_URL = `${SUPABASE_URL}/functions/v1/admin-game-bridge`;
const LINK_SENT_KEY = "triangulate_event_admin_last_link";
// Matches Supabase Auth's default OTP rate-limit window (60s).
const LINK_COOLDOWN_MS = 60_000;

// Client-side allowlist mirrors the live-site admin_users row. Purely
// a UX gate — the bridge enforces the same rule server-side.
const ADMIN_EMAIL_ALLOWLIST = ["triangulate.game@gmail.com"];

function isAdminEmail(email) {
  return ADMIN_EMAIL_ALLOWLIST.includes((email || "").trim().toLowerCase());
}

function rememberLinkSent(email) {
  try {
    localStorage.setItem(LINK_SENT_KEY, JSON.stringify({ email, at: Date.now() }));
  } catch { /* localStorage unavailable */ }
}

function pendingLinkFor(email) {
  try {
    const data = JSON.parse(localStorage.getItem(LINK_SENT_KEY) || "null");
    if (!data || data.email !== email) return null;
    if (Date.now() - data.at > LINK_COOLDOWN_MS) return null;
    return data;
  } catch { return null; }
}

const state = {
  authedEmail: "",
  accessToken: "",
  events: [],
  meetingPoints: [],
  activeTab: "dashboard",
  filters: { eventStatus: "" },
  detail: { eventId: null, registrations: [], attendees: [], teamMembers: [], event: null },
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDateShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short" });
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? " ago" : " from now";
  if (abs < 60) return Math.round(abs) + "s" + suffix;
  if (abs < 3600) return Math.round(abs / 60) + "m" + suffix;
  if (abs < 86400) return Math.round(abs / 3600) + "h" + suffix;
  if (abs < 604800) return Math.round(abs / 86400) + "d" + suffix;
  return new Date(iso).toLocaleDateString("en-GB");
}

function setLoginStatus(msg, kind = "info") {
  if (els.loginStatus) {
    els.loginStatus.textContent = msg;
    els.loginStatus.dataset.kind = kind;
  }
}

function setDashboardStatus(msg, kind = "info") {
  if (els.dashboardStatus) {
    els.dashboardStatus.textContent = msg;
    els.dashboardStatus.dataset.kind = kind;
  }
}

// ─── Auth (live-site magic link) ─────────────────────────────────────────────

function tokenFromHash() {
  if (!window.location.hash) return "";
  const params = new URLSearchParams(window.location.hash.slice(1));
  const err = params.get("error_description") || params.get("error");
  if (err) setLoginStatus(err, "error");
  const token = params.get("access_token") || "";
  if (token) {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
  }
  return token;
}

async function getSupabaseUser(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not verify the login link. Request a fresh one.");
  return res.json();
}

async function checkAdminRow(email, accessToken) {
  const url = `${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(email)}&select=email,role,display_name`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function setAuthed(email, token) {
  state.authedEmail = email;
  state.accessToken = token;
  const ok = Boolean(email && token);
  if (els.loginPanel) els.loginPanel.hidden = ok;
  if (els.dashboard) els.dashboard.hidden = !ok;
}

async function restoreSession() {
  const token = tokenFromHash() || sessionStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) {
    setAuthed("", "");
    return false;
  }
  try {
    const user = await getSupabaseUser(token);
    const email = String(user.email || "").toLowerCase();
    const admin = await checkAdminRow(email, token);
    if (!admin) {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      setAuthed("", "");
      setLoginStatus(`Signed in as ${email}, but this email isn't on the admin allowlist.`, "error");
      return false;
    }
    setAuthed(email, token);
    return true;
  } catch (err) {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    setAuthed("", "");
    setLoginStatus(err instanceof Error ? err.message : "Could not verify login.", "error");
    return false;
  }
}

async function sendMagicLink(email) {
  const redirectTo = new URL("./admin-events.html", window.location.href).toString();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: true, redirect_to: redirectTo }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error_description || body.msg || "Could not send login link.");
  }
}

// ─── Bridge call ─────────────────────────────────────────────────────────────

async function bridge(action, body = {}) {
  const res = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${state.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `Bridge failed (${res.status})`);
  }
  return data;
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadAllData() {
  setDashboardStatus("Loading from game…");
  try {
    const [eventsData, mpData] = await Promise.all([
      bridge("list_events"),
      bridge("meeting_points"),
    ]);
    state.events = Array.isArray(eventsData.events) ? eventsData.events : [];
    state.meetingPoints = Array.isArray(mpData.meeting_points) ? mpData.meeting_points : [];
    setDashboardStatus(`Loaded ${state.events.length} events from the game project.`);
    populateFilters();
    renderActive();
  } catch (err) {
    setDashboardStatus(err.message || "Failed to load.", "error");
  }
}

function populateFilters() {
  const sel = $("event-filter-status");
  if (!sel) return;
  // Game statuses, in the order they appear in events lifecycle.
  const statuses = ["pending", "open", "locked_in", "done", "cancelled", "rejected"];
  sel.innerHTML = '<option value="">All statuses</option>' +
    statuses.map((s) => `<option value="${s}">${s}</option>`).join("");
}

// ─── Tab switching ───────────────────────────────────────────────────────────

function setActiveTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".event-admin__tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".event-admin__panel").forEach((panel) => {
    const active = panel.dataset.panel === name;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  renderActive();
}

function renderActive() {
  switch (state.activeTab) {
    case "dashboard": renderDashboard(); break;
    case "events": renderEvents(); break;
    case "venues": renderVenues(); break;
  }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function liveEvents() {
  // "Live" = scheduled or in progress. Game's rule: open events whose
  // starts_at hasn't passed yet (plus locked_in).
  const now = Date.now();
  return state.events.filter((e) => {
    if (!["open", "locked_in"].includes(e.status)) return false;
    if (!e.scheduled_for) return true;
    return new Date(e.scheduled_for).getTime() > now;
  });
}

function pastEvents() {
  // Done events + open events whose time has passed (game cron will
  // either flip them to done or sweep them).
  const now = Date.now();
  return state.events.filter((e) => {
    if (e.status === "done") return true;
    if (!e.scheduled_for) return false;
    return ["open", "locked_in"].includes(e.status)
      && new Date(e.scheduled_for).getTime() < now;
  });
}

function pendingEvents() {
  return state.events.filter((e) => e.status === "pending");
}

function renderDashboard() {
  const events = state.events;
  const live = liveEvents();
  const pending = pendingEvents();
  const past = pastEvents();
  const cancelled = events.filter((e) => e.status === "cancelled");
  const rejected = events.filter((e) => e.status === "rejected");
  const totalRsvp = events.reduce((sum, e) => sum + (Number(e.registration_count) || 0), 0);
  const totalTeamMembers = events.reduce((sum, e) => sum + (Number(e.team_member_count) || 0), 0);

  const kpis = [
    { label: "Live", value: live.length, sub: "scheduled or in progress", tone: live.length ? "ok" : "muted" },
    { label: "Pending approval", value: pending.length, sub: pending.length ? "needs admin review" : "queue clear", tone: pending.length ? "warn" : "ok" },
    { label: "Past events", value: past.length, sub: "completed or auto-detected" },
    { label: "Cancelled", value: cancelled.length, sub: "host-cancelled (kept 7 days)" },
    { label: "Rejected", value: rejected.length, sub: "admin-rejected or auto-expired" },
    { label: "Total RSVPs", value: totalRsvp.toLocaleString(), sub: "going + maybe + interested" },
    { label: "Crew picks", value: totalTeamMembers.toLocaleString(), sub: "host-selected teammates" },
    { label: "Total events", value: events.length, sub: "in the game database" },
  ];

  $("event-kpi-grid").innerHTML = kpis.map((k) => `
    <div class="event-kpi event-kpi--${k.tone || "neutral"}">
      <p class="event-kpi__label">${escapeHtml(k.label)}</p>
      <p class="event-kpi__value">${escapeHtml(String(k.value))}</p>
      <p class="event-kpi__sub">${escapeHtml(k.sub || "")}</p>
    </div>
  `).join("");

  renderTimeline(live);
  renderPendingApprovals(pending);
}

function renderTimeline(items) {
  const sorted = items
    .filter((e) => e.scheduled_for)
    .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));

  if (!sorted.length) {
    $("event-timeline").innerHTML = '<p class="event-empty">No live events scheduled. Players create events from the mobile app; once approved they appear here.</p>';
    return;
  }
  const byDay = new Map();
  sorted.forEach((e) => {
    const key = fmtDateShort(e.scheduled_for);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  });
  $("event-timeline").innerHTML = [...byDay.entries()].map(([day, evts]) => `
    <div class="event-timeline__day">
      <div class="event-timeline__day-label">${escapeHtml(day)}</div>
      <div class="event-timeline__day-cards">
        ${evts.map(renderTimelineCard).join("")}
      </div>
    </div>
  `).join("");
}

function renderTimelineCard(e) {
  const rsvp = Number(e.registration_count) || 0;
  return `
    <button class="event-timeline__card" data-open-event="${escapeHtml(e.id)}">
      <div class="event-timeline__card-head">
        <span class="event-pill event-pill--${escapeHtml(e.status)}">${escapeHtml(e.status)}</span>
        <span class="event-timeline__time">${fmtDate(e.scheduled_for).split(", ").pop()}</span>
      </div>
      <p class="event-timeline__title">${escapeHtml(e.title || "Meet up")}</p>
      <p class="event-timeline__meta">${escapeHtml(e.meeting_point_name || "—")}${e.meeting_point_parent_name ? ` · ${escapeHtml(e.meeting_point_parent_name)}` : ""}</p>
      <p class="event-timeline__capacity">${rsvp} RSVP${rsvp === 1 ? "" : "s"} · host ${escapeHtml(e.creator_nickname || "—")}</p>
    </button>
  `;
}

function renderPendingApprovals(items) {
  const approveAllBtn = $("approve-all-pending");
  if (approveAllBtn) {
    approveAllBtn.disabled = items.length === 0;
    approveAllBtn.textContent = items.length > 1 ? `Approve all (${items.length})` : "Approve all";
  }
  const list = $("event-pending-list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<li class="event-empty">No events awaiting approval.</li>';
    return;
  }
  list.innerHTML = items.slice(0, 20).map((e) => `
    <li class="event-pending-row" data-event-id="${escapeHtml(e.id)}">
      <div class="event-pending-row__who">
        <button class="event-link" data-open-event="${escapeHtml(e.id)}">${escapeHtml(e.title || "Meet up")}</button>
        <span class="event-pending-row__when">${e.scheduled_for ? "for " + fmtDate(e.scheduled_for) : "whenever works"} · host ${escapeHtml(e.creator_nickname || "—")}</span>
      </div>
      <div class="event-pending-row__event">
        <span>${escapeHtml(e.meeting_point_name || "—")}${e.meeting_point_postcode ? ` · ${escapeHtml(e.meeting_point_postcode)}` : ""}</span>
        <span class="event-table__sub">submitted ${fmtRelative(e.created_at || e.scheduled_for)}</span>
      </div>
      <div class="event-pending-row__actions">
        <button class="button button--primary button--small" data-approval-action="approve" data-event-id="${escapeHtml(e.id)}">Approve</button>
        <button class="button button--quiet button--small" data-approval-action="reject" data-event-id="${escapeHtml(e.id)}">Reject</button>
      </div>
    </li>
  `).join("");
}

// ─── Events tab ──────────────────────────────────────────────────────────────

function renderEvents() {
  const { eventStatus } = state.filters;
  const filtered = state.events.filter((e) => !eventStatus || e.status === eventStatus);
  $("event-list-summary").textContent =
    `${filtered.length} event${filtered.length === 1 ? "" : "s"}` +
    (eventStatus ? ` · ${eventStatus}` : "");

  if (!filtered.length) {
    $("event-table-body").innerHTML = '<tr><td colspan="6" class="event-empty">No events match.</td></tr>';
    return;
  }
  $("event-table-body").innerHTML = filtered.map((e) => `
    <tr data-event-id="${escapeHtml(e.id)}">
      <td>${e.scheduled_for ? fmtDate(e.scheduled_for) : "whenever works"}</td>
      <td>
        <button class="event-link" data-open-event="${escapeHtml(e.id)}">${escapeHtml(e.title || "Meet up")}</button>
        <p class="event-table__sub">host ${escapeHtml(e.creator_nickname || "—")}</p>
      </td>
      <td>
        ${escapeHtml(e.meeting_point_name || "—")}
        <p class="event-table__sub">${escapeHtml(e.meeting_point_parent_name || e.meeting_point_postcode || "")}</p>
      </td>
      <td><span class="event-pill event-pill--${escapeHtml(e.status)}">${escapeHtml(e.status)}</span></td>
      <td class="event-table__num">${Number(e.registration_count) || 0}</td>
      <td class="event-table__actions">
        <button class="button button--quiet button--small" data-open-event="${escapeHtml(e.id)}">View</button>
      </td>
    </tr>
  `).join("");
}

// ─── Venues tab (meeting_points) ─────────────────────────────────────────────

function renderVenues() {
  const rows = state.meetingPoints;
  $("venues-summary").textContent =
    `${rows.length} meeting point${rows.length === 1 ? "" : "s"} (active only)`;
  if (!rows.length) {
    $("venues-table-body").innerHTML = '<tr><td colspan="3" class="event-empty">No active meeting points.</td></tr>';
    return;
  }
  $("venues-table-body").innerHTML = rows.map((v) => `
    <tr>
      <td>${escapeHtml(v.name || "—")}</td>
      <td>${escapeHtml(v.city || "—")}</td>
      <td>${escapeHtml(v.postcode || v.address || "—")}</td>
    </tr>
  `).join("");
}

// ─── Event detail drawer ─────────────────────────────────────────────────────

async function openEvent(eventId) {
  $("event-drawer-eyebrow").textContent = "Loading…";
  $("event-drawer-title").textContent = "";
  $("event-drawer-meta").textContent = "";
  $("event-drawer-body").innerHTML = '<p class="event-empty">Fetching from game…</p>';
  $("event-drawer").hidden = false;
  document.body.classList.add("event-drawer-open");

  try {
    const data = await bridge("event_detail", { event_id: eventId });
    state.detail = {
      eventId,
      event: data.event,
      registrations: data.registrations || [],
      attendees: data.attendees || [],
      teamMembers: data.team_members || [],
    };
    renderDrawer();
  } catch (err) {
    $("event-drawer-body").innerHTML = `<p class="admin-inline-status" data-kind="error">${escapeHtml(err.message)}</p>`;
  }
}

function renderDrawer() {
  const { event: e, registrations, attendees, teamMembers } = state.detail;
  if (!e) {
    $("event-drawer-body").innerHTML = '<p class="event-empty">Event not found.</p>';
    return;
  }
  // Find the matching row from list_events (has joined fields)
  const listed = state.events.find((x) => x.id === e.id) || {};
  $("event-drawer-eyebrow").textContent = e.status;
  $("event-drawer-title").textContent = e.title || "Meet up";
  $("event-drawer-meta").textContent =
    `${e.scheduled_for ? fmtDate(e.scheduled_for) : "whenever works"} · host ${listed.creator_nickname || "—"}` +
    (listed.meeting_point_name ? ` · ${listed.meeting_point_name}` : "");

  const byStatus = (rs, st) => rs.filter((r) => r.status === st).length;

  $("event-drawer-body").innerHTML = `
    <div class="event-drawer__kpis">
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Going</p>
        <p class="event-kpi__value">${byStatus(registrations, "going")}</p>
        <p class="event-kpi__sub">${byStatus(registrations, "maybe")} maybe · ${byStatus(registrations, "interested")} interested</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Attended</p>
        <p class="event-kpi__value">${attendees.length}</p>
        <p class="event-kpi__sub">auto-detected via triangles</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Crew</p>
        <p class="event-kpi__value">${teamMembers.length}</p>
        <p class="event-kpi__sub">${escapeHtml(e.team_name || "no crew name")}</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Cancelled?</p>
        <p class="event-kpi__value" style="font-size:1rem">${e.cancelled_at ? fmtDateShort(e.cancelled_at) : "no"}</p>
        <p class="event-kpi__sub">${e.attendance_detected_at ? "attendance detected " + fmtRelative(e.attendance_detected_at) : "no attendance scan yet"}</p>
      </div>
    </div>

    ${e.plan_note ? `<section class="event-drawer__section"><h4>Plan note</h4><p>${escapeHtml(e.plan_note)}</p></section>` : ""}

    <section class="event-drawer__section">
      <h4>RSVPs (${registrations.length})</h4>
      ${registrations.length ? `
        <ul class="event-feedback-list">
          ${registrations.map((r) => `
            <li>
              <span class="event-pill event-pill--${r.status === "going" ? "ok" : r.status === "out" ? "muted" : "neutral"}">${escapeHtml(r.status)}</span>
              <span>${escapeHtml(r.player_profiles?.nickname || "—")}</span>
              <span class="event-feedback-list__when">${r.auto_registered ? "walk-in" : "self-rsvp"} · ${fmtRelative(r.updated_at || r.created_at)}</span>
            </li>
          `).join("")}
        </ul>
      ` : '<p class="event-empty">No RSVPs yet.</p>'}
    </section>

    ${attendees.length ? `
      <section class="event-drawer__section">
        <h4>Attendees (${attendees.length})</h4>
        <ul class="event-feedback-list">
          ${attendees.map((a) => `
            <li>
              <span class="event-pill event-pill--${a.method === "registered_attended" ? "ok" : "neutral"}">${escapeHtml(a.method)}</span>
              <span>${escapeHtml(a.player_profiles?.nickname || "—")}</span>
              <span class="event-feedback-list__when">${fmtRelative(a.detected_at)}</span>
            </li>
          `).join("")}
        </ul>
      </section>
    ` : ""}

    ${teamMembers.length ? `
      <section class="event-drawer__section">
        <h4>Crew (${teamMembers.length})</h4>
        <ul class="event-feedback-list">
          ${teamMembers.map((t) => `
            <li>
              <span class="event-pill event-pill--${t.role === "captain" ? "ok" : "neutral"}">${escapeHtml(t.role)}</span>
              <span>${escapeHtml(t.player_profiles?.nickname || "—")}</span>
              <span class="event-feedback-list__when">${fmtRelative(t.added_at)}</span>
            </li>
          `).join("")}
        </ul>
      </section>
    ` : ""}

    <section class="event-drawer__section">
      <h4>Admin actions</h4>
      <div class="event-drawer__actions">
        ${e.status === "pending" ? `
          <button class="button button--primary" data-approval-action="approve" data-event-id="${escapeHtml(e.id)}">Approve event</button>
          <button class="button button--quiet" data-approval-action="reject" data-event-id="${escapeHtml(e.id)}">Reject event</button>
        ` : ""}
        ${["pending", "open", "locked_in"].includes(e.status) ? `
          <button class="button button--quiet" data-approval-action="cancel" data-event-id="${escapeHtml(e.id)}">Cancel event</button>
        ` : ""}
      </div>
      <p class="event-table__sub" style="margin-top:0.5rem">Cancellation only works for events the admin player owns. Reject keeps the row for 7 days then the game's nightly cron deletes it.</p>
    </section>
  `;
}

function closeDrawer() {
  $("event-drawer").hidden = true;
  document.body.classList.remove("event-drawer-open");
}

// ─── Approval actions ────────────────────────────────────────────────────────

async function handleApprovalAction(action, eventId) {
  if (!eventId) return;
  const verb = action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Cancel";
  if (action === "reject" || action === "cancel") {
    if (!window.confirm(`${verb} this event? This is reversible only by the host (cancellation) or not at all (rejection).`)) return;
  }
  setDashboardStatus(`${verb}ing…`);
  try {
    await bridge(action, { event_id: eventId });
    setDashboardStatus(`${verb} sent.`);
    await loadAllData();
    if (state.detail.eventId === eventId) await openEvent(eventId);
  } catch (err) {
    setDashboardStatus(err.message || `${verb} failed.`, "error");
  }
}

async function approveAllPending() {
  const items = pendingEvents();
  if (!items.length) return;
  if (!window.confirm(`Approve all ${items.length} pending event${items.length === 1 ? "" : "s"}?`)) return;
  setDashboardStatus("Approving all…");
  try {
    const res = await bridge("approve_all");
    setDashboardStatus(`Approved ${res.approved} event${res.approved === 1 ? "" : "s"}.`);
    await loadAllData();
  } catch (err) {
    setDashboardStatus(err.message || "Bulk approve failed.", "error");
  }
}

// ─── Delegated click handler ─────────────────────────────────────────────────

function bindEventDelegation() {
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    const openEv = t.closest?.("[data-open-event]");
    if (openEv) { ev.preventDefault(); openEvent(openEv.dataset.openEvent); return; }
    const approval = t.closest?.("[data-approval-action]");
    if (approval) { ev.preventDefault(); handleApprovalAction(approval.dataset.approvalAction, approval.dataset.eventId); return; }
    if (t.matches?.("[data-close-drawer]") || t.closest?.("[data-close-drawer]")) closeDrawer();
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

function cacheEls() {
  Object.assign(els, {
    loginPanel: $("admin-login-panel"),
    loginForm: $("admin-login-form"),
    loginStatus: $("admin-login-status"),
    email: $("admin-email"),
    dashboard: $("admin-dashboard"),
    dashboardStatus: $("event-admin-status"),
  });
}

function bindFixedHandlers() {
  const submitBtn = els.loginForm?.querySelector('button[type="submit"]');
  const defaultSubmitLabel = submitBtn?.textContent || "Send login link";

  function applyPendingState() {
    if (!submitBtn) return;
    const current = (els.email?.value || "").trim().toLowerCase();
    if (current && pendingLinkFor(current)) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitted";
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = defaultSubmitLabel;
    }
  }

  els.email?.addEventListener("input", applyPendingState);
  applyPendingState();

  els.loginForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = els.email.value.trim().toLowerCase();
    if (!email) return;
    if (!isAdminEmail(email)) {
      setLoginStatus("That email isn't authorised for the admin portal.", "error");
      return;
    }
    if (pendingLinkFor(email)) { applyPendingState(); return; }
    setLoginStatus("");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending…"; }
    try {
      await sendMagicLink(email);
    } catch { /* silent — show Submitted regardless */ }
    rememberLinkSent(email);
    if (submitBtn) submitBtn.textContent = "Submitted";
    setLoginStatus("");
  });

  $("event-admin-sign-out")?.addEventListener("click", () => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    setAuthed("", "");
  });
  $("event-admin-refresh")?.addEventListener("click", () => loadAllData());
  $("approve-all-pending")?.addEventListener("click", approveAllPending);

  document.querySelectorAll(".event-admin__tab").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  $("event-filter-status")?.addEventListener("change", (ev) => {
    state.filters.eventStatus = ev.target.value;
    renderEvents();
  });
}

async function init() {
  cacheEls();
  bindFixedHandlers();
  bindEventDelegation();
  const ok = await restoreSession();
  if (ok) loadAllData();
}

document.addEventListener("DOMContentLoaded", init);
