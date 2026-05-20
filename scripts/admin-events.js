import "./site-core.js";
import { SUPABASE_KEY, SUPABASE_URL } from "./site-config.js";

const ACCESS_TOKEN_KEY = "triangulate_event_admin_access_token";
const BRIDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/admin-bridge`;
const LINK_SENT_KEY = "triangulate_event_admin_last_link";
// Matches Supabase Auth's default OTP rate-limit window (60s) — beyond
// this point a re-send would actually go through, so we let the user retry.
const LINK_COOLDOWN_MS = 60_000;

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
  activeTab: "dashboard",
  events: [],
  venues: [],
  participants: [],
  registrations: [],
  teams: [],
  feedback: [],
  comms: [],
  audit: [],
  kpis: [],
  filters: {
    eventStatus: "",
    eventCity: "",
    participantSearch: "",
    participantSegment: "",
    commsChannel: "",
    commsStatus: "",
  },
  selectedParticipants: new Set(),
  bridge: { mixpanel: null, attio: null, status: "idle" },
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

function fmtMoney(pence) {
  if (!pence) return "—";
  return "£" + (pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
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
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short" });
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const abs = Math.abs(diff);
  const sign = diff >= 0 ? "" : "in ";
  const suffix = diff >= 0 ? " ago" : "";
  if (abs < 60) return sign + Math.round(abs) + "s" + suffix;
  if (abs < 3600) return sign + Math.round(abs / 60) + "m" + suffix;
  if (abs < 86400) return sign + Math.round(abs / 3600) + "h" + suffix;
  if (abs < 604800) return sign + Math.round(abs / 86400) + "d" + suffix;
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

// ─── Auth ────────────────────────────────────────────────────────────────────

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

// ─── REST helpers (PostgREST under user JWT) ─────────────────────────────────

async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${state.accessToken}`,
      "Content-Type": "application/json",
      Prefer: opts.method && opts.method !== "GET" ? "return=representation" : "",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status}) on ${path}`);
  }
  return res.json();
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadAllData() {
  setDashboardStatus("Loading data…");
  try {
    const [events, venues, participants, registrations, teams, feedback, comms, audit, kpis] = await Promise.all([
      rest("events?select=*&order=starts_at.desc&limit=200"),
      rest("venues?select=*&order=name.asc"),
      rest("participants?select=*&order=last_seen_at.desc.nullslast&limit=500"),
      rest("event_registrations?select=*&order=registered_at.desc&limit=2000"),
      rest("teams?select=*"),
      rest("event_feedback?select=*&order=created_at.desc&limit=500"),
      rest("comms_log?select=*&order=created_at.desc&limit=500"),
      rest("admin_audit_log?select=*&order=created_at.desc&limit=100"),
      rest("event_kpis?select=*"),
    ]);
    state.events = events;
    state.venues = venues;
    state.participants = participants;
    state.registrations = registrations;
    state.teams = teams;
    state.feedback = feedback;
    state.comms = comms;
    state.audit = audit;
    state.kpis = kpis;
    setDashboardStatus(`Loaded ${events.length} events, ${participants.length} participants.`);
    populateFilterDropdowns();
    renderActive();
    loadBridge();
  } catch (err) {
    setDashboardStatus(err.message || "Failed to load data.", "error");
  }
}

function populateFilterDropdowns() {
  const cities = [...new Set(state.events.map((e) => e.city).filter(Boolean))].sort();
  const sel = $("event-filter-city");
  if (sel) {
    sel.innerHTML = '<option value="">All cities</option>' +
      cities.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }
  const venueSel = $("event-modal-venue");
  if (venueSel) {
    venueSel.innerHTML = '<option value="">—</option>' +
      state.venues.map((v) =>
        `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)} — ${escapeHtml(v.city || "")}</option>`
      ).join("");
  }
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
    case "participants": renderParticipants(); break;
    case "teams": renderTeams(); break;
    case "comms": renderComms(); break;
    case "reports": renderReports(); break;
    case "audit": renderAudit(); break;
  }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function renderDashboard() {
  const now = Date.now();
  const upcoming = state.events.filter((e) =>
    e.status === "scheduled" || e.status === "live"
  );
  const completed = state.events.filter((e) => e.status === "completed");
  const live = state.events.filter((e) => e.status === "live");
  const totalRegistered = state.registrations.filter((r) =>
    ["registered", "confirmed", "checked_in", "attended"].includes(r.status)
  ).length;
  const totalAttended = state.registrations.filter((r) => r.status === "attended").length;
  const noShows = state.registrations.filter((r) => r.status === "no_show").length;
  const attendanceRate = totalAttended + noShows > 0
    ? Math.round((100 * totalAttended) / (totalAttended + noShows)) : 0;
  const revenuePence = state.registrations
    .filter((r) => r.payment_status === "paid")
    .reduce((sum, r) => sum + (r.payment_pence || 0), 0);
  const avgCapacity = state.kpis.length
    ? Math.round(state.kpis.reduce((s, k) => s + (k.capacity_pct || 0), 0) / state.kpis.length)
    : 0;
  const npsScores = state.feedback.filter((f) => f.nps_score != null);
  const promoters = npsScores.filter((f) => f.nps_score >= 9).length;
  const detractors = npsScores.filter((f) => f.nps_score <= 6).length;
  const nps = npsScores.length
    ? Math.round(100 * (promoters - detractors) / npsScores.length) : 0;

  const kpis = [
    { label: "Live now", value: live.length, sub: live.length ? "events in progress" : "no live events", tone: live.length ? "ok" : "muted" },
    { label: "Upcoming 14d", value: upcoming.filter((e) => new Date(e.starts_at) - now < 14 * 86400000).length, sub: "scheduled + live" },
    { label: "Completed total", value: completed.length, sub: "all-time" },
    { label: "Attended", value: totalAttended.toLocaleString(), sub: `${attendanceRate}% attendance rate` },
    { label: "Registered (active)", value: totalRegistered.toLocaleString(), sub: "open + completed events" },
    { label: "Avg fill", value: avgCapacity + "%", sub: "capacity across all events", tone: avgCapacity > 80 ? "warn" : avgCapacity > 50 ? "ok" : "muted" },
    { label: "Revenue (paid)", value: fmtMoney(revenuePence), sub: "lifetime, all events" },
    { label: "NPS", value: isNaN(nps) ? "—" : nps, sub: `${npsScores.length} responses`, tone: nps >= 50 ? "ok" : nps >= 0 ? "warn" : "bad" },
  ];

  $("event-kpi-grid").innerHTML = kpis.map((k) => `
    <div class="event-kpi event-kpi--${k.tone || "neutral"}">
      <p class="event-kpi__label">${escapeHtml(k.label)}</p>
      <p class="event-kpi__value">${escapeHtml(String(k.value))}</p>
      <p class="event-kpi__sub">${escapeHtml(k.sub || "")}</p>
    </div>
  `).join("");

  renderTimeline();
  renderActivity();
  renderCapacityList();
}

function renderTimeline() {
  const now = Date.now();
  const windowEnd = now + 14 * 86400000;
  const items = state.events
    .filter((e) => {
      const t = new Date(e.starts_at).getTime();
      return t >= now - 3600000 && t <= windowEnd && ["scheduled", "live", "postponed"].includes(e.status);
    })
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  if (!items.length) {
    $("event-timeline").innerHTML = '<p class="event-empty">No events in the next 14 days.</p>';
    return;
  }

  // Group by day
  const byDay = new Map();
  items.forEach((e) => {
    const key = fmtDateShort(e.starts_at);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  });

  $("event-timeline").innerHTML = [...byDay.entries()].map(([day, evts]) => `
    <div class="event-timeline__day">
      <div class="event-timeline__day-label">${escapeHtml(day)}</div>
      <div class="event-timeline__day-cards">
        ${evts.map((e) => renderTimelineCard(e)).join("")}
      </div>
    </div>
  `).join("");
}

function renderTimelineCard(e) {
  const kpi = state.kpis.find((k) => k.event_id === e.id);
  const fill = kpi?.capacity_pct || 0;
  const registered = kpi?.registered_count || 0;
  const fillTone = fill > 90 ? "hot" : fill > 70 ? "warm" : "cool";
  return `
    <button class="event-timeline__card" data-event-id="${escapeHtml(e.id)}">
      <div class="event-timeline__card-head">
        <span class="event-pill event-pill--${e.status}">${escapeHtml(e.status)}</span>
        <span class="event-timeline__time">${fmtDate(e.starts_at).split(", ").pop()}</span>
      </div>
      <p class="event-timeline__title">${escapeHtml(e.name)}</p>
      <p class="event-timeline__meta">${escapeHtml(e.city || "—")} · ${escapeHtml(e.event_type)}</p>
      <div class="event-capacity-bar event-capacity-bar--${fillTone}">
        <div class="event-capacity-bar__fill" style="width: ${Math.min(100, fill)}%"></div>
      </div>
      <p class="event-timeline__capacity">${registered} / ${e.capacity} · ${fill}%</p>
    </button>
  `;
}

function renderActivity() {
  const items = state.audit.slice(0, 10);
  const ul = $("event-activity-list");
  if (!items.length) {
    ul.innerHTML = '<li class="event-empty">No recent activity.</li>';
    return;
  }
  ul.innerHTML = items.map((a) => `
    <li class="event-activity-item">
      <span class="event-activity-item__when">${fmtRelative(a.created_at)}</span>
      <span class="event-activity-item__who">${escapeHtml(a.admin_email)}</span>
      <span class="event-activity-item__what">${escapeHtml(a.action)}</span>
      <span class="event-activity-item__entity">${escapeHtml(a.entity_type || "")}</span>
    </li>
  `).join("");
}

function renderCapacityList() {
  const sorted = [...state.kpis]
    .filter((k) => ["scheduled", "live"].includes(k.status))
    .sort((a, b) => (b.capacity_pct || 0) - (a.capacity_pct || 0))
    .slice(0, 6);
  if (!sorted.length) {
    $("event-capacity-list").innerHTML = '<li class="event-empty">No active sessions to rank.</li>';
    return;
  }
  $("event-capacity-list").innerHTML = sorted.map((k) => {
    const tone = k.capacity_pct > 90 ? "hot" : k.capacity_pct > 70 ? "warm" : "cool";
    return `
      <li class="event-capacity-row" data-event-id="${escapeHtml(k.event_id)}">
        <div>
          <p class="event-capacity-row__name">${escapeHtml(k.name)}</p>
          <p class="event-capacity-row__sub">${escapeHtml(k.city || "—")} · ${fmtDateShort(k.starts_at)}</p>
        </div>
        <div class="event-capacity-row__bar event-capacity-bar event-capacity-bar--${tone}">
          <div class="event-capacity-bar__fill" style="width: ${Math.min(100, k.capacity_pct || 0)}%"></div>
        </div>
        <div class="event-capacity-row__num">${k.registered_count}/${k.capacity}</div>
      </li>
    `;
  }).join("");
}

// ─── Events table ────────────────────────────────────────────────────────────

function renderEvents() {
  const { eventStatus, eventCity } = state.filters;
  const filtered = state.events.filter((e) => {
    if (eventStatus && e.status !== eventStatus) return false;
    if (eventCity && e.city !== eventCity) return false;
    return true;
  });
  $("event-list-summary").textContent =
    `${filtered.length} event${filtered.length === 1 ? "" : "s"}` +
    (eventStatus ? ` · ${eventStatus}` : "") +
    (eventCity ? ` · ${eventCity}` : "");

  if (!filtered.length) {
    $("event-table-body").innerHTML = '<tr><td colspan="8" class="event-empty">No events match.</td></tr>';
    return;
  }

  $("event-table-body").innerHTML = filtered.map((e) => {
    const kpi = state.kpis.find((k) => k.event_id === e.id) || {};
    const fill = kpi.capacity_pct || 0;
    const fillTone = fill > 90 ? "hot" : fill > 70 ? "warm" : "cool";
    return `
      <tr data-event-id="${escapeHtml(e.id)}">
        <td>${fmtDate(e.starts_at)}</td>
        <td>
          <button class="event-link" data-open-event="${escapeHtml(e.id)}">${escapeHtml(e.name)}</button>
          <p class="event-table__sub">${escapeHtml(e.event_type)}</p>
        </td>
        <td>${escapeHtml(e.city || "—")}</td>
        <td><span class="event-pill event-pill--${e.status}">${escapeHtml(e.status)}</span></td>
        <td>${escapeHtml(e.cohort || "—")}</td>
        <td>
          <div class="event-capacity-bar event-capacity-bar--${fillTone}" title="${fill}%">
            <div class="event-capacity-bar__fill" style="width: ${Math.min(100, fill)}%"></div>
          </div>
          <p class="event-table__sub">${kpi.registered_count || 0}/${e.capacity} · ${fill}%</p>
        </td>
        <td class="event-table__num">${fmtMoney(kpi.revenue_pence || 0)}</td>
        <td class="event-table__actions">
          <button class="button button--quiet button--small" data-open-event="${escapeHtml(e.id)}">View</button>
        </td>
      </tr>
    `;
  }).join("");
}

// ─── Event detail drawer ─────────────────────────────────────────────────────

function openEvent(eventId) {
  const e = state.events.find((x) => x.id === eventId);
  if (!e) return;
  const venue = state.venues.find((v) => v.id === e.venue_id);
  const regs = state.registrations.filter((r) => r.event_id === eventId);
  const teams = state.teams.filter((t) => t.event_id === eventId);
  const feedback = state.feedback.filter((f) => f.event_id === eventId);
  const comms = state.comms.filter((c) => c.event_id === eventId);
  const kpi = state.kpis.find((k) => k.event_id === eventId) || {};

  $("event-drawer-eyebrow").textContent = e.event_type + (e.cohort ? ` · cohort ${e.cohort}` : "");
  $("event-drawer-title").textContent = e.name;
  $("event-drawer-meta").textContent =
    `${fmtDate(e.starts_at)} → ${fmtDate(e.ends_at)} · ${venue?.name || e.city || "—"}`;

  const byStatus = (s) => regs.filter((r) => r.status === s);
  const npsScores = feedback.filter((f) => f.nps_score != null);
  const promoters = npsScores.filter((f) => f.nps_score >= 9).length;
  const detractors = npsScores.filter((f) => f.nps_score <= 6).length;
  const nps = npsScores.length ? Math.round(100 * (promoters - detractors) / npsScores.length) : null;

  $("event-drawer-body").innerHTML = `
    <div class="event-drawer__kpis">
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Registered</p>
        <p class="event-kpi__value">${kpi.registered_count || 0}</p>
        <p class="event-kpi__sub">cap ${e.capacity} · ${kpi.capacity_pct || 0}%</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Attended</p>
        <p class="event-kpi__value">${kpi.attended_count || 0}</p>
        <p class="event-kpi__sub">${kpi.no_show_count || 0} no-shows · ${kpi.cancelled_count || 0} cancels</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Waitlisted</p>
        <p class="event-kpi__value">${kpi.waitlisted_count || 0}</p>
        <p class="event-kpi__sub">cap ${e.waitlist_capacity}</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">NPS</p>
        <p class="event-kpi__value">${nps == null ? "—" : nps}</p>
        <p class="event-kpi__sub">${npsScores.length} responses</p>
      </div>
    </div>

    <section class="event-drawer__section">
      <h4>Description</h4>
      <p>${escapeHtml(e.description || "—")}</p>
      ${e.notes ? `<p class="event-drawer__notes"><strong>Notes:</strong> ${escapeHtml(e.notes)}</p>` : ""}
    </section>

    <section class="event-drawer__section">
      <div class="event-drawer__section-head">
        <h4>Roster (${regs.length})</h4>
        <div class="event-drawer__section-actions">
          <button class="button button--secondary button--small" data-event-action="export-roster" data-event-id="${escapeHtml(e.id)}">Export CSV</button>
          <button class="button button--secondary button--small" data-event-action="send-comms" data-event-id="${escapeHtml(e.id)}">Send reminder</button>
          <button class="button button--quiet button--small" data-event-action="capacity-override" data-event-id="${escapeHtml(e.id)}">Capacity override</button>
        </div>
      </div>
      <div class="event-roster-counts">
        <span class="event-pill event-pill--neutral">registered ${byStatus("registered").length}</span>
        <span class="event-pill event-pill--ok">checked_in ${byStatus("checked_in").length}</span>
        <span class="event-pill event-pill--ok">attended ${byStatus("attended").length}</span>
        <span class="event-pill event-pill--warn">no_show ${byStatus("no_show").length}</span>
        <span class="event-pill event-pill--neutral">waitlisted ${byStatus("waitlisted").length}</span>
        <span class="event-pill event-pill--muted">cancelled ${byStatus("cancelled").length}</span>
      </div>
      <div class="event-roster-table-wrap">
        <table class="event-table event-table--compact">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Team</th>
              <th>Position</th>
              <th>Payment</th>
              <th>Channel</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${regs.map((r) => renderRosterRow(r, teams)).join("")}</tbody>
        </table>
      </div>
    </section>

    <section class="event-drawer__section">
      <h4>Teams (${teams.length})</h4>
      <div class="event-teams-grid event-teams-grid--compact">
        ${teams.length ? teams.map((t) => renderTeamCard(t, regs)).join("") : '<p class="event-empty">No teams formed.</p>'}
      </div>
    </section>

    ${feedback.length ? `
    <section class="event-drawer__section">
      <h4>Feedback (${feedback.length})</h4>
      <ul class="event-feedback-list">
        ${feedback.slice(0, 8).map((f) => `
          <li>
            <span class="event-feedback-list__nps">NPS ${f.nps_score ?? "—"}</span>
            <span class="event-feedback-list__rating">${"★".repeat(f.rating || 0)}${"☆".repeat(5 - (f.rating || 0))}</span>
            <span class="event-feedback-list__comment">${escapeHtml(f.comment || "—")}</span>
          </li>
        `).join("")}
      </ul>
    </section>
    ` : ""}

    ${comms.length ? `
    <section class="event-drawer__section">
      <h4>Comms (${comms.length})</h4>
      <ul class="event-feedback-list">
        ${comms.slice(0, 6).map((c) => `
          <li>
            <span class="event-pill event-pill--neutral">${escapeHtml(c.channel)}</span>
            <span>${escapeHtml(c.subject || "—")}</span>
            <span class="event-pill event-pill--${c.status === "delivered" || c.status === "opened" || c.status === "clicked" ? "ok" : "muted"}">${escapeHtml(c.status)}</span>
            <span class="event-feedback-list__when">${fmtRelative(c.sent_at || c.created_at)}</span>
          </li>
        `).join("")}
      </ul>
    </section>
    ` : ""}

    <section class="event-drawer__section">
      <h4>Actions</h4>
      <div class="event-drawer__actions">
        <button class="button button--secondary" data-event-action="edit" data-event-id="${escapeHtml(e.id)}">Edit event</button>
        ${e.status !== "cancelled" ? `<button class="button button--quiet" data-event-action="cancel" data-event-id="${escapeHtml(e.id)}">Cancel event</button>` : ""}
        ${e.status === "scheduled" ? `<button class="button button--primary" data-event-action="go-live" data-event-id="${escapeHtml(e.id)}">Mark live</button>` : ""}
        ${e.status === "live" ? `<button class="button button--primary" data-event-action="complete" data-event-id="${escapeHtml(e.id)}">Mark completed</button>` : ""}
      </div>
    </section>
  `;

  $("event-drawer").hidden = false;
  document.body.classList.add("event-drawer-open");
}

function renderRosterRow(r, teams) {
  const p = state.participants.find((x) => x.id === r.participant_id);
  const team = r.team_id ? teams.find((t) => t.id === r.team_id) : null;
  return `
    <tr>
      <td>
        <p class="event-roster__name">${escapeHtml(p?.full_name || "—")}</p>
        <p class="event-table__sub">${escapeHtml(p?.email || "")}</p>
      </td>
      <td>
        <select class="event-select event-select--small" data-reg-status data-reg-id="${escapeHtml(r.id)}">
          ${["registered","waitlisted","confirmed","checked_in","attended","no_show","cancelled","refunded"]
            .map((s) => `<option value="${s}"${s === r.status ? " selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        ${team ? `<span class="event-team-chip event-team-chip--${team.colour}">${escapeHtml(team.name)}</span>` : "—"}
      </td>
      <td>${r.position_in_triangle ? `#${r.position_in_triangle}` : "—"}</td>
      <td>
        <span class="event-pill event-pill--${r.payment_status === "paid" ? "ok" : "muted"}">${escapeHtml(r.payment_status)}</span>
        ${r.payment_pence ? ` ${fmtMoney(r.payment_pence)}` : ""}
      </td>
      <td>${escapeHtml(r.channel || "—")}</td>
      <td><button class="event-link" data-open-participant="${escapeHtml(r.participant_id)}">profile</button></td>
    </tr>
  `;
}

function renderTeamCard(team, regs) {
  const members = regs.filter((r) => r.team_id === team.id)
    .sort((a, b) => (a.position_in_triangle || 0) - (b.position_in_triangle || 0));
  return `
    <div class="event-team-card event-team-card--${team.colour}">
      <header>
        <span class="event-team-chip event-team-chip--${team.colour}">${escapeHtml(team.name)}</span>
        <span class="event-team-card__count">${members.length}/3</span>
      </header>
      <ul>
        ${[1, 2, 3].map((pos) => {
          const m = members.find((mm) => mm.position_in_triangle === pos);
          const p = m ? state.participants.find((pp) => pp.id === m.participant_id) : null;
          return `
            <li class="event-team-slot${p ? " event-team-slot--filled" : ""}">
              <span class="event-team-slot__pos">#${pos}</span>
              <span class="event-team-slot__name">${p ? escapeHtml(p.full_name || p.email) : "open"}</span>
            </li>
          `;
        }).join("")}
      </ul>
    </div>
  `;
}

// ─── Participants ────────────────────────────────────────────────────────────

function renderParticipants() {
  const q = state.filters.participantSearch.toLowerCase();
  const seg = state.filters.participantSegment;
  const rows = state.participants.filter((p) => {
    if (seg && p.segment !== seg) return false;
    if (q) {
      const hay = `${p.full_name || ""} ${p.email} ${p.city || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  $("participant-summary").textContent =
    `${rows.length} participant${rows.length === 1 ? "" : "s"}` +
    (state.selectedParticipants.size ? ` · ${state.selectedParticipants.size} selected` : "");

  $("participant-table-body").innerHTML = rows.slice(0, 200).map((p) => `
    <tr>
      <td><input type="checkbox" data-participant-select value="${escapeHtml(p.id)}"${state.selectedParticipants.has(p.id) ? " checked" : ""} /></td>
      <td><button class="event-link" data-open-participant="${escapeHtml(p.id)}">${escapeHtml(p.full_name || "—")}</button></td>
      <td>${escapeHtml(p.email)}</td>
      <td>${escapeHtml(p.city || "—")}</td>
      <td><span class="event-pill event-pill--neutral">${escapeHtml(p.segment)}</span></td>
      <td>${escapeHtml(p.cohort || "—")}</td>
      <td>${escapeHtml(p.source || "—")}</td>
      <td class="event-table__num">${p.total_events_attended || 0}</td>
      <td class="event-table__num">${p.total_no_shows || 0}</td>
      <td class="event-table__num">${fmtMoney(p.lifetime_value_pence || 0)}</td>
      <td>${fmtRelative(p.last_seen_at)}</td>
      <td><button class="event-link" data-open-participant="${escapeHtml(p.id)}">open</button></td>
    </tr>
  `).join("") || '<tr><td colspan="12" class="event-empty">No participants match.</td></tr>';
}

function openParticipant(participantId) {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return;
  const regs = state.registrations.filter((r) => r.participant_id === participantId);
  const comms = state.comms.filter((c) => c.participant_id === participantId);
  const feedback = state.feedback.filter((f) => f.participant_id === participantId);

  $("event-drawer-eyebrow").textContent = `Participant · ${p.segment}`;
  $("event-drawer-title").textContent = p.full_name || p.email;
  $("event-drawer-meta").textContent =
    `${p.email} · ${p.city || "—"}${p.cohort ? ` · cohort ${p.cohort}` : ""}`;

  $("event-drawer-body").innerHTML = `
    <div class="event-drawer__kpis">
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Attended</p>
        <p class="event-kpi__value">${p.total_events_attended || 0}</p>
        <p class="event-kpi__sub">${p.total_no_shows || 0} no-shows</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">LTV</p>
        <p class="event-kpi__value">${fmtMoney(p.lifetime_value_pence || 0)}</p>
        <p class="event-kpi__sub">paid events</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Source</p>
        <p class="event-kpi__value" style="font-size: 1.4rem">${escapeHtml(p.source || "—")}</p>
        <p class="event-kpi__sub">first seen ${fmtRelative(p.first_seen_at)}</p>
      </div>
      <div class="event-kpi event-kpi--neutral">
        <p class="event-kpi__label">Consent</p>
        <p class="event-kpi__value" style="font-size: 1rem">
          ${p.consent_marketing ? "📧" : "·"} marketing<br>
          ${p.consent_photo ? "📷" : "·"} photo
        </p>
        <p class="event-kpi__sub">${p.is_blocked ? "BLOCKED" : "active"}</p>
      </div>
    </div>

    ${p.notes ? `<section class="event-drawer__section"><h4>Notes</h4><p>${escapeHtml(p.notes)}</p></section>` : ""}

    <section class="event-drawer__section">
      <h4>Registrations (${regs.length})</h4>
      <ul class="event-feedback-list">
        ${regs.map((r) => {
          const e = state.events.find((x) => x.id === r.event_id);
          return `
            <li>
              <span class="event-pill event-pill--${r.status === "attended" ? "ok" : r.status === "no_show" ? "warn" : "neutral"}">${escapeHtml(r.status)}</span>
              <span>${escapeHtml(e?.name || "—")}</span>
              <span class="event-feedback-list__when">${fmtDateShort(e?.starts_at || r.registered_at)}</span>
            </li>
          `;
        }).join("") || '<li class="event-empty">No registrations.</li>'}
      </ul>
    </section>

    ${comms.length ? `
    <section class="event-drawer__section">
      <h4>Comms (${comms.length})</h4>
      <ul class="event-feedback-list">
        ${comms.slice(0, 8).map((c) => `
          <li>
            <span class="event-pill event-pill--neutral">${escapeHtml(c.channel)}</span>
            <span>${escapeHtml(c.subject || "—")}</span>
            <span class="event-pill event-pill--${["delivered","opened","clicked"].includes(c.status) ? "ok" : "muted"}">${escapeHtml(c.status)}</span>
          </li>
        `).join("")}
      </ul>
    </section>
    ` : ""}

    ${feedback.length ? `
    <section class="event-drawer__section">
      <h4>Feedback given (${feedback.length})</h4>
      <ul class="event-feedback-list">
        ${feedback.map((f) => `
          <li>
            <span class="event-feedback-list__nps">NPS ${f.nps_score ?? "—"}</span>
            <span class="event-feedback-list__comment">${escapeHtml(f.comment || "—")}</span>
          </li>
        `).join("")}
      </ul>
    </section>
    ` : ""}

    <section class="event-drawer__section">
      <h4>External</h4>
      <ul class="event-feedback-list">
        <li><span>Attio</span> <span>${p.attio_person_id ? `<code>${escapeHtml(p.attio_person_id)}</code>` : "<em>not linked</em>"}</span></li>
        <li><span>Mixpanel</span> <span>${p.mixpanel_distinct_id ? `<code>${escapeHtml(p.mixpanel_distinct_id)}</code>` : "<em>not linked</em>"}</span></li>
      </ul>
    </section>
  `;

  $("event-drawer").hidden = false;
  document.body.classList.add("event-drawer-open");
}

// ─── Teams tab ───────────────────────────────────────────────────────────────

function renderTeams() {
  $("teams-summary").textContent = `${state.teams.length} teams across ${
    new Set(state.teams.map((t) => t.event_id)).size
  } events`;

  const byEvent = new Map();
  state.teams.forEach((t) => {
    if (!byEvent.has(t.event_id)) byEvent.set(t.event_id, []);
    byEvent.get(t.event_id).push(t);
  });

  const sorted = [...byEvent.entries()]
    .map(([eid, teams]) => ({
      event: state.events.find((e) => e.id === eid),
      teams,
    }))
    .filter((x) => x.event)
    .sort((a, b) => new Date(b.event.starts_at) - new Date(a.event.starts_at))
    .slice(0, 20);

  $("event-teams-grid").innerHTML = sorted.map(({ event, teams }) => `
    <section class="event-teams-section">
      <header>
        <p class="panel-label">${escapeHtml(event.city || "—")} · ${fmtDateShort(event.starts_at)}</p>
        <h4><button class="event-link" data-open-event="${escapeHtml(event.id)}">${escapeHtml(event.name)}</button></h4>
      </header>
      <div class="event-teams-grid event-teams-grid--compact">
        ${teams.map((t) => renderTeamCard(t, state.registrations.filter((r) => r.event_id === event.id))).join("")}
      </div>
    </section>
  `).join("") || '<p class="event-empty">No teams yet.</p>';
}

// ─── Comms tab ───────────────────────────────────────────────────────────────

function renderComms() {
  const { commsChannel, commsStatus } = state.filters;
  const rows = state.comms.filter((c) => {
    if (commsChannel && c.channel !== commsChannel) return false;
    if (commsStatus && c.status !== commsStatus) return false;
    return true;
  }).slice(0, 200);

  $("comms-summary").textContent = `${rows.length} comms in view (of ${state.comms.length} total)`;

  $("comms-table-body").innerHTML = rows.map((c) => {
    const p = state.participants.find((x) => x.id === c.participant_id);
    const e = state.events.find((x) => x.id === c.event_id);
    return `
      <tr>
        <td>${fmtRelative(c.sent_at || c.created_at)}</td>
        <td><span class="event-pill event-pill--neutral">${escapeHtml(c.channel)}</span></td>
        <td>${escapeHtml(c.subject || "—")}</td>
        <td>${escapeHtml(p?.full_name || p?.email || "—")}</td>
        <td>${e ? `<button class="event-link" data-open-event="${escapeHtml(e.id)}">${escapeHtml(e.name)}</button>` : "—"}</td>
        <td><span class="event-pill event-pill--${["delivered","opened","clicked"].includes(c.status) ? "ok" : c.status === "failed" || c.status === "bounced" ? "warn" : "muted"}">${escapeHtml(c.status)}</span></td>
        <td><code>${escapeHtml(c.template_key || "—")}</code></td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="7" class="event-empty">No comms match.</td></tr>';
}

// ─── Reports tab ─────────────────────────────────────────────────────────────

function renderReports() {
  // KPI grid for reports
  const completed = state.events.filter((e) => e.status === "completed");
  const totalRegs = state.registrations.length;
  const attended = state.registrations.filter((r) => r.status === "attended").length;
  const noShows = state.registrations.filter((r) => r.status === "no_show").length;
  const cancelled = state.registrations.filter((r) => r.status === "cancelled").length;
  const noShowPct = attended + noShows ? Math.round(100 * noShows / (attended + noShows)) : 0;
  const cancellationPct = totalRegs ? Math.round(100 * cancelled / totalRegs) : 0;
  const repeatPlayers = state.participants.filter((p) => (p.total_events_attended || 0) > 1).length;
  const retentionPct = state.participants.length
    ? Math.round(100 * repeatPlayers / state.participants.length) : 0;
  const npsScores = state.feedback.filter((f) => f.nps_score != null);
  const promoters = npsScores.filter((f) => f.nps_score >= 9).length;
  const detractors = npsScores.filter((f) => f.nps_score <= 6).length;
  const nps = npsScores.length ? Math.round(100 * (promoters - detractors) / npsScores.length) : 0;
  const avgRating = state.feedback.length
    ? (state.feedback.reduce((s, f) => s + (f.rating || 0), 0) / state.feedback.length).toFixed(2)
    : "—";

  const reportKpis = [
    { label: "Completed events", value: completed.length },
    { label: "Total registrations", value: totalRegs.toLocaleString() },
    { label: "No-show rate", value: noShowPct + "%", tone: noShowPct > 20 ? "warn" : "ok" },
    { label: "Cancellation rate", value: cancellationPct + "%", tone: cancellationPct > 15 ? "warn" : "ok" },
    { label: "Repeat rate", value: retentionPct + "%", tone: retentionPct > 30 ? "ok" : "muted" },
    { label: "NPS", value: nps, tone: nps >= 50 ? "ok" : nps >= 0 ? "warn" : "bad" },
    { label: "Avg rating", value: avgRating, sub: `${state.feedback.length} responses` },
    { label: "Promoters", value: promoters, sub: `${detractors} detractors`, tone: "ok" },
  ];

  $("reports-kpi-grid").innerHTML = reportKpis.map((k) => `
    <div class="event-kpi event-kpi--${k.tone || "neutral"}">
      <p class="event-kpi__label">${escapeHtml(k.label)}</p>
      <p class="event-kpi__value">${escapeHtml(String(k.value))}</p>
      <p class="event-kpi__sub">${escapeHtml(k.sub || "")}</p>
    </div>
  `).join("");

  // Per-event report rows (last 90 days)
  const cutoff = Date.now() - 90 * 86400000;
  const recent = completed
    .filter((e) => new Date(e.starts_at).getTime() > cutoff)
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

  $("reports-table-body").innerHTML = recent.map((e) => {
    const regs = state.registrations.filter((r) => r.event_id === e.id);
    const att = regs.filter((r) => r.status === "attended").length;
    const ns = regs.filter((r) => r.status === "no_show").length;
    const nsPct = att + ns ? Math.round(100 * ns / (att + ns)) : 0;
    const fb = state.feedback.filter((f) => f.event_id === e.id);
    const nps = fb.filter((f) => f.nps_score != null);
    const promo = nps.filter((f) => f.nps_score >= 9).length;
    const det = nps.filter((f) => f.nps_score <= 6).length;
    const evNps = nps.length ? Math.round(100 * (promo - det) / nps.length) : null;
    const avgR = fb.length ? (fb.reduce((s, f) => s + (f.rating || 0), 0) / fb.length).toFixed(1) : "—";
    const wouldReturn = fb.filter((f) => f.would_return).length;
    const wouldReturnPct = fb.length ? Math.round(100 * wouldReturn / fb.length) : 0;
    return `
      <tr>
        <td><button class="event-link" data-open-event="${escapeHtml(e.id)}">${escapeHtml(e.name)}</button></td>
        <td>${fmtDateShort(e.starts_at)}</td>
        <td class="event-table__num">${regs.length}</td>
        <td class="event-table__num">${att}</td>
        <td class="event-table__num">${nsPct}%</td>
        <td class="event-table__num">${evNps == null ? "—" : evNps}</td>
        <td class="event-table__num">${avgR}</td>
        <td class="event-table__num">${fb.length ? wouldReturnPct + "%" : "—"}</td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="8" class="event-empty">No completed events in last 90 days.</td></tr>';

  renderBridge();
}

// ─── Mixpanel + Attio bridge ─────────────────────────────────────────────────

async function loadBridge() {
  state.bridge.status = "loading";
  renderBridge();
  try {
    const res = await fetch(BRIDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${state.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scope: "summary" }),
    });
    if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
    const data = await res.json();
    state.bridge.mixpanel = data.mixpanel || null;
    state.bridge.attio = data.attio || null;
    state.bridge.status = data.mixpanel?.live || data.attio?.live ? "live" : "mock";
  } catch (err) {
    state.bridge.status = "mock";
    state.bridge.mixpanel = mockMixpanel();
    state.bridge.attio = mockAttio();
  }
  if (state.activeTab === "reports") renderBridge();
}

function mockMixpanel() {
  const completed = state.events.filter((e) => e.status === "completed").length;
  const total = state.participants.length;
  const attended = state.registrations.filter((r) => r.status === "attended").length;
  const registered = state.registrations.length;
  return {
    live: false,
    project: 4004554,
    region: "EU",
    funnel: [
      { step: "Waitlist Joined", count: total },
      { step: "Event Viewed", count: Math.round(total * 0.74) },
      { step: "Registration Started", count: registered },
      { step: "Registration Completed", count: Math.round(registered * 0.93) },
      { step: "Event Attended", count: attended },
    ],
    note: "Mock — wire MIXPANEL_SERVICE_ACCOUNT_USERNAME / SECRET in the admin-bridge function to go live.",
    completed_events: completed,
  };
}

function mockAttio() {
  const linked = state.participants.filter((p) => p.attio_person_id).slice(0, 6);
  return {
    live: false,
    workspace: "triangulate",
    sample: state.participants.slice(0, 8).map((p) => ({
      person_id: p.attio_person_id || `mock-${p.id.slice(0, 8)}`,
      email: p.email,
      name: p.full_name,
      segment: p.segment,
      status: ["target", "contacted", "replied", "active"][Math.floor(Math.random() * 4)],
    })),
    linked_count: linked.length,
    total_people: state.participants.length,
    note: "Mock — wire ATTIO_API_KEY in the admin-bridge function to go live.",
  };
}

function renderBridge() {
  const mx = state.bridge.mixpanel;
  const at = state.bridge.attio;

  if ($("mixpanel-status")) {
    $("mixpanel-status").textContent = state.bridge.status === "live" ? "live" : "mock";
    $("mixpanel-status").dataset.kind = state.bridge.status;
  }
  if ($("attio-status")) {
    $("attio-status").textContent = state.bridge.status === "live" ? "live" : "mock";
    $("attio-status").dataset.kind = state.bridge.status;
  }

  if (mx && $("mixpanel-funnel")) {
    const max = Math.max(...mx.funnel.map((f) => f.count), 1);
    $("mixpanel-funnel").innerHTML = mx.funnel.map((f) => `
      <div class="event-funnel__step">
        <div class="event-funnel__label">
          <span>${escapeHtml(f.step)}</span>
          <span><strong>${f.count.toLocaleString()}</strong></span>
        </div>
        <div class="event-funnel__bar">
          <div class="event-funnel__fill" style="width: ${Math.round(100 * f.count / max)}%"></div>
        </div>
      </div>
    `).join("") + `<p class="event-funnel__note">${escapeHtml(mx.note || "")}</p>`;
  }

  if (at && $("attio-list")) {
    $("attio-list").innerHTML = (at.sample || []).map((p) => `
      <li class="event-attio-row">
        <span class="event-attio-row__name">${escapeHtml(p.name || p.email)}</span>
        <span class="event-pill event-pill--neutral">${escapeHtml(p.segment || "—")}</span>
        <span class="event-pill event-pill--ok">${escapeHtml(p.status || "—")}</span>
        <code class="event-attio-row__id">${escapeHtml(p.person_id)}</code>
      </li>
    `).join("") + `<li class="event-funnel__note">${escapeHtml(at.note || "")}</li>`;
  }
}

// ─── Audit tab ───────────────────────────────────────────────────────────────

function renderAudit() {
  $("audit-summary").textContent = `${state.audit.length} admin actions logged`;
  $("audit-table-body").innerHTML = state.audit.map((a) => `
    <tr>
      <td>${fmtRelative(a.created_at)}</td>
      <td>${escapeHtml(a.admin_email)}</td>
      <td><code>${escapeHtml(a.action)}</code></td>
      <td>${escapeHtml(a.entity_type || "—")}${a.entity_id ? ` <code class="event-table__sub">${escapeHtml(a.entity_id.slice(0, 8))}</code>` : ""}</td>
      <td><code class="event-audit__payload">${escapeHtml(JSON.stringify(a.payload || {}))}</code></td>
    </tr>
  `).join("") || '<tr><td colspan="5" class="event-empty">No audit entries.</td></tr>';
}

// ─── Mutations ───────────────────────────────────────────────────────────────

async function patchRegistration(regId, patch) {
  const updated = await rest(`event_registrations?id=eq.${encodeURIComponent(regId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (Array.isArray(updated) && updated[0]) {
    Object.assign(state.registrations.find((r) => r.id === regId) || {}, updated[0]);
  }
  await logAudit("registration.update", "event_registrations", regId, patch);
}

async function patchEvent(eventId, patch) {
  const updated = await rest(`events?id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (Array.isArray(updated) && updated[0]) {
    Object.assign(state.events.find((e) => e.id === eventId) || {}, updated[0]);
  }
  await logAudit(`event.${patch.status || "update"}`, "events", eventId, patch);
}

async function createEvent(payload) {
  const created = await rest("events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (Array.isArray(created) && created[0]) {
    state.events.unshift(created[0]);
    await logAudit("event.create", "events", created[0].id, { source: "admin-ui" });
  }
  return created[0];
}

async function logAudit(action, entityType, entityId, payload) {
  try {
    await rest("admin_audit_log", {
      method: "POST",
      body: JSON.stringify({
        admin_email: state.authedEmail,
        action,
        entity_type: entityType,
        entity_id: entityId,
        payload,
      }),
    });
  } catch {
    // non-fatal
  }
}

// ─── CSV export ──────────────────────────────────────────────────────────────

function downloadCsv(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportParticipantsCsv() {
  const selected = state.selectedParticipants.size
    ? state.participants.filter((p) => state.selectedParticipants.has(p.id))
    : state.participants;
  downloadCsv(
    selected.map((p) => ({
      email: p.email,
      full_name: p.full_name,
      city: p.city,
      segment: p.segment,
      cohort: p.cohort,
      source: p.source,
      total_events_attended: p.total_events_attended,
      total_no_shows: p.total_no_shows,
      lifetime_value_pence: p.lifetime_value_pence,
      consent_marketing: p.consent_marketing,
      last_seen_at: p.last_seen_at,
    })),
    `triangulate-participants-${new Date().toISOString().slice(0, 10)}.csv`
  );
  logAudit("bulk.csv_export", "participants", null, { row_count: selected.length });
}

function exportEventRoster(eventId) {
  const e = state.events.find((x) => x.id === eventId);
  const regs = state.registrations.filter((r) => r.event_id === eventId);
  const rows = regs.map((r) => {
    const p = state.participants.find((x) => x.id === r.participant_id);
    return {
      event_name: e?.name,
      event_starts_at: e?.starts_at,
      participant_name: p?.full_name,
      participant_email: p?.email,
      participant_phone: p?.phone_number,
      participant_city: p?.city,
      status: r.status,
      team_id: r.team_id || "",
      position_in_triangle: r.position_in_triangle || "",
      payment_status: r.payment_status,
      payment_pence: r.payment_pence,
      registered_at: r.registered_at,
      checked_in_at: r.checked_in_at,
      channel: r.channel,
    };
  });
  downloadCsv(rows, `roster-${e?.slug || e?.id || "event"}.csv`);
  logAudit("event.export_roster", "events", eventId, { row_count: rows.length });
}

// ─── Modal: new event ────────────────────────────────────────────────────────

function openNewEventModal() {
  const form = $("event-modal-form");
  form.reset();
  $("event-modal-title").textContent = "Create event";
  $("event-modal-status").textContent = "";
  $("event-modal").hidden = false;
  document.body.classList.add("event-modal-open");
}

function closeModal() {
  $("event-modal").hidden = true;
  document.body.classList.remove("event-modal-open");
}

function closeDrawer() {
  $("event-drawer").hidden = true;
  document.body.classList.remove("event-drawer-open");
}

async function handleModalSubmit(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const fd = new FormData(form);
  const startsAt = fd.get("starts_at");
  const endsAt = fd.get("ends_at");
  if (!startsAt || !endsAt) {
    $("event-modal-status").textContent = "Start and end times are required.";
    $("event-modal-status").dataset.kind = "error";
    return;
  }
  const payload = {
    name: fd.get("name"),
    description: fd.get("description") || null,
    event_type: fd.get("event_type"),
    status: fd.get("status"),
    cohort: fd.get("cohort") || null,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    venue_id: fd.get("venue_id") || null,
    city: fd.get("city") || null,
    capacity: Number(fd.get("capacity")) || 24,
    waitlist_capacity: Number(fd.get("waitlist_capacity")) || 8,
    price_pence: Math.round(Number(fd.get("price_pounds") || 0) * 100),
    created_by_email: state.authedEmail,
  };
  $("event-modal-submit").disabled = true;
  $("event-modal-status").textContent = "Saving…";
  try {
    await createEvent(payload);
    closeModal();
    setDashboardStatus("Event created.");
    await loadAllData();
  } catch (err) {
    $("event-modal-status").textContent = err.message || "Could not create event.";
    $("event-modal-status").dataset.kind = "error";
  } finally {
    $("event-modal-submit").disabled = false;
  }
}

// ─── Event actions (cancel / mark live / etc.) ───────────────────────────────

async function handleEventAction(action, eventId) {
  const e = state.events.find((x) => x.id === eventId);
  if (!e) return;
  switch (action) {
    case "cancel": {
      const reason = prompt(`Cancel "${e.name}" — reason for the audit log?`, "weather");
      if (reason == null) return;
      await patchEvent(eventId, { status: "cancelled", cancellation_reason: reason });
      openEvent(eventId);
      break;
    }
    case "go-live":
      await patchEvent(eventId, { status: "live" });
      openEvent(eventId);
      break;
    case "complete":
      await patchEvent(eventId, { status: "completed" });
      openEvent(eventId);
      break;
    case "export-roster":
      exportEventRoster(eventId);
      break;
    case "send-comms": {
      const subject = prompt(`Subject line for reminder to ${e.name}?`, `Reminder — ${e.name}`);
      if (!subject) return;
      const regs = state.registrations.filter(
        (r) => r.event_id === eventId && ["registered", "confirmed", "checked_in"].includes(r.status)
      );
      try {
        const rows = regs.map((r) => ({
          participant_id: r.participant_id,
          event_id: eventId,
          channel: "email",
          direction: "outbound",
          subject,
          body_snippet: `Quick reminder about ${e.name}…`,
          status: "queued",
          template_key: "manual_reminder",
          sent_by_admin_email: state.authedEmail,
        }));
        if (rows.length) {
          await rest("comms_log", { method: "POST", body: JSON.stringify(rows) });
          await logAudit("comms.batch_queue", "events", eventId, { recipient_count: rows.length });
          setDashboardStatus(`Queued ${rows.length} comms for ${e.name}.`);
        }
      } catch (err) {
        setDashboardStatus(err.message || "Could not queue comms.", "error");
      }
      break;
    }
    case "capacity-override": {
      const next = prompt(`Current capacity for "${e.name}" is ${e.capacity}. New capacity?`, String(e.capacity));
      if (!next || isNaN(Number(next))) return;
      await patchEvent(eventId, { capacity: Number(next) });
      openEvent(eventId);
      break;
    }
    case "edit":
      // Future: prefill the modal; for now, status-only edit via prompt.
      setDashboardStatus("Inline edit coming next. Use Cancel + Create for now.");
      break;
  }
}

// ─── Global delegated click + change handlers ───────────────────────────────

function bindEventDelegation() {
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    const openEv = t.closest?.("[data-open-event]");
    if (openEv) {
      ev.preventDefault();
      openEvent(openEv.dataset.openEvent);
      return;
    }
    const openP = t.closest?.("[data-open-participant]");
    if (openP) {
      ev.preventDefault();
      openParticipant(openP.dataset.openParticipant);
      return;
    }
    const action = t.closest?.("[data-event-action]");
    if (action) {
      ev.preventDefault();
      handleEventAction(action.dataset.eventAction, action.dataset.eventId);
      return;
    }
    if (t.matches?.("[data-close-drawer]") || t.closest?.("[data-close-drawer]")) {
      closeDrawer();
    }
    if (t.matches?.("[data-close-modal]") || t.closest?.("[data-close-modal]")) {
      closeModal();
    }
  });

  document.addEventListener("change", async (ev) => {
    const sel = ev.target;
    if (sel.matches?.("[data-reg-status]")) {
      const regId = sel.dataset.regId;
      const next = sel.value;
      const patch = { status: next };
      if (next === "checked_in") patch.checked_in_at = new Date().toISOString();
      if (next === "cancelled") patch.cancelled_at = new Date().toISOString();
      try {
        await patchRegistration(regId, patch);
        const reg = state.registrations.find((r) => r.id === regId);
        if (reg) openEvent(reg.event_id);
      } catch (err) {
        setDashboardStatus(err.message || "Could not update registration.", "error");
      }
    }
    if (sel.matches?.("[data-participant-select]")) {
      if (sel.checked) state.selectedParticipants.add(sel.value);
      else state.selectedParticipants.delete(sel.value);
      $("participant-summary").textContent =
        `${state.participants.length} total · ${state.selectedParticipants.size} selected`;
    }
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

// Fixed admin login email — UI has no email input; magic links always go
// to this address. Other rows in admin_users (e.g. ziv1.lazar@gmail.com)
// can still sign in by triggering the OTP flow directly, but the login
// button on /admin-events.html is single-purpose.
const FIXED_LOGIN_EMAIL = "triangulate.game@gmail.com";

function cacheEls() {
  Object.assign(els, {
    loginPanel: $("admin-login-panel"),
    loginForm: $("admin-login-form"),
    loginStatus: $("admin-login-status"),
    dashboard: $("admin-dashboard"),
    dashboardStatus: $("event-admin-status"),
  });
}

function bindFixedHandlers() {
  const submitBtn = els.loginForm?.querySelector('button[type="submit"]');
  const defaultSubmitLabel = submitBtn?.textContent || "Send login link";

  function applyPendingState() {
    if (!submitBtn) return;
    if (pendingLinkFor(FIXED_LOGIN_EMAIL)) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitted";
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = defaultSubmitLabel;
    }
  }

  applyPendingState();

  els.loginForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = FIXED_LOGIN_EMAIL;
    if (pendingLinkFor(email)) {
      applyPendingState();
      return;
    }
    setLoginStatus("");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
    }
    try {
      await sendMagicLink(email);
    } catch {
      // Swallow upstream errors (rate-limit, transient network, etc.) —
      // we always lock to "Submitted" so the user has a single, clean
      // confirmation. They can try a different email or wait out the
      // cooldown window if needed.
    }
    rememberLinkSent(email);
    if (submitBtn) submitBtn.textContent = "Submitted";
    setLoginStatus("");
  });

  $("event-admin-sign-out")?.addEventListener("click", () => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    setAuthed("", "");
  });

  $("event-admin-refresh")?.addEventListener("click", () => loadAllData());

  document.querySelectorAll(".event-admin__tab").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  $("event-filter-status")?.addEventListener("change", (ev) => {
    state.filters.eventStatus = ev.target.value;
    renderEvents();
  });
  $("event-filter-city")?.addEventListener("change", (ev) => {
    state.filters.eventCity = ev.target.value;
    renderEvents();
  });
  $("event-new")?.addEventListener("click", openNewEventModal);

  $("participant-search")?.addEventListener("input", (ev) => {
    state.filters.participantSearch = ev.target.value;
    renderParticipants();
  });
  $("participant-filter-segment")?.addEventListener("change", (ev) => {
    state.filters.participantSegment = ev.target.value;
    renderParticipants();
  });
  $("participant-export")?.addEventListener("click", exportParticipantsCsv);
  $("participant-select-all")?.addEventListener("change", (ev) => {
    state.selectedParticipants = ev.target.checked
      ? new Set(state.participants.map((p) => p.id))
      : new Set();
    renderParticipants();
  });

  $("comms-filter-channel")?.addEventListener("change", (ev) => {
    state.filters.commsChannel = ev.target.value;
    renderComms();
  });
  $("comms-filter-status")?.addEventListener("change", (ev) => {
    state.filters.commsStatus = ev.target.value;
    renderComms();
  });

  $("event-modal-form")?.addEventListener("submit", handleModalSubmit);
}

async function init() {
  cacheEls();
  bindFixedHandlers();
  bindEventDelegation();
  const ok = await restoreSession();
  if (ok) loadAllData();
}

document.addEventListener("DOMContentLoaded", init);
