import "./site-core.js";
import { SUPABASE_KEY, SUPABASE_URL } from "./site-config.js";

const ADMIN_EMAIL = "triangulate.game@gmail.com";
const QUEUE_URL = "./data/social-approval-queue.json";
const PUBLISH_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/social-publish-approved`;
const ACCESS_TOKEN_KEY = "triangulate_social_admin_access_token";
const DECISION_KEY_PREFIX = "triangulate_social_admin_decisions:";

const state = {
  authedEmail: "",
  queuePayload: null,
  decisions: {},
  filter: "all",
};

const els = {
  loginPanel: document.getElementById("admin-login-panel"),
  loginForm: document.getElementById("admin-login-form"),
  loginStatus: document.getElementById("admin-login-status"),
  email: document.getElementById("admin-email"),
  dashboard: document.getElementById("admin-dashboard"),
  statusCard: document.getElementById("admin-status-card"),
  statusCopy: document.getElementById("admin-status-copy"),
  queueTitle: document.getElementById("admin-queue-title"),
  queueMeta: document.getElementById("admin-queue-meta"),
  summaryGrid: document.getElementById("admin-summary-grid"),
  filterRow: document.getElementById("admin-filter-row"),
  draftGrid: document.getElementById("admin-draft-grid"),
  dashboardStatus: document.getElementById("admin-dashboard-status"),
  export: document.getElementById("admin-export"),
  publish: document.getElementById("admin-publish"),
  reset: document.getElementById("admin-reset"),
  signOut: document.getElementById("admin-sign-out"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function setLoginStatus(message, kind = "info") {
  els.loginStatus.textContent = message;
  els.loginStatus.dataset.kind = kind;
}

function setDashboardStatus(message, kind = "info") {
  els.dashboardStatus.textContent = message;
  els.dashboardStatus.dataset.kind = kind;
}

function setAccessState(email) {
  state.authedEmail = email;
  const isAuthed = email.toLowerCase() === ADMIN_EMAIL;
  els.loginPanel.hidden = isAuthed;
  els.dashboard.hidden = !isAuthed;
  els.statusCard.classList.toggle("admin-status-card--ok", isAuthed);
  els.statusCopy.textContent = isAuthed
    ? `Signed in as ${email}. Review decisions stay local until exported.`
    : "Sign in with the approved admin email to review the queue.";
}

function tokenFromHash() {
  if (!window.location.hash) return "";
  const params = new URLSearchParams(window.location.hash.slice(1));
  const error = params.get("error_description") || params.get("error");
  if (error) {
    setLoginStatus(error, "error");
  }

  const token = params.get("access_token") || "";
  if (token) {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
  }
  return token;
}

async function getSupabaseUser(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error("Could not verify the login link. Please request a fresh one.");
  }

  return res.json();
}

async function restoreSession() {
  const token = tokenFromHash() || sessionStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) {
    setAccessState("");
    return false;
  }

  try {
    const user = await getSupabaseUser(token);
    const email = String(user.email || "").toLowerCase();
    if (email !== ADMIN_EMAIL) {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      setAccessState("");
      setLoginStatus(`Signed in as ${email || "unknown"}, but this dashboard is restricted to ${ADMIN_EMAIL}.`, "error");
      return false;
    }

    setAccessState(email);
    return true;
  } catch (error) {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    setAccessState("");
    setLoginStatus(error instanceof Error ? error.message : "Could not verify login.", "error");
    return false;
  }
}

async function sendMagicLink(email) {
  const redirectTo = new URL("./admin-social.html", window.location.href).toString();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      create_user: true,
      redirect_to: redirectTo,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error_description || body.msg || "Could not send login link. Check Supabase Auth settings.");
  }
}

function queueId() {
  return state.queuePayload?.sourceQueueFile || state.queuePayload?.queue?.generatedAt || "current";
}

function decisionsKey() {
  return `${DECISION_KEY_PREFIX}${queueId()}`;
}

function loadDecisions() {
  try {
    state.decisions = JSON.parse(localStorage.getItem(decisionsKey()) || "{}");
  } catch {
    state.decisions = {};
  }
}

function saveDecisions() {
  localStorage.setItem(decisionsKey(), JSON.stringify(state.decisions));
}

function draftId(index) {
  return `draft-${index}`;
}

function getDecision(index) {
  return state.decisions[draftId(index)] || { status: "pending", notes: "", copyMode: "local", mediaUrl: "" };
}

function updateDecision(index, patch) {
  const id = draftId(index);
  state.decisions[id] = {
    ...getDecision(index),
    ...patch,
    decidedAt: new Date().toISOString(),
    decidedBy: state.authedEmail,
  };
  saveDecisions();
  renderDashboard();
}

function copyTextForDraft(draft, decision) {
  const useFallback = decision.copyMode === "general" && draft.fallbackCopy;
  return {
    hook: useFallback ? draft.fallbackCopy.hook : draft.hook,
    caption: useFallback ? draft.fallbackCopy.caption : draft.caption,
    hashtags: useFallback ? draft.fallbackCopy.hashtags : draft.hashtags,
    notes: useFallback ? draft.fallbackCopy.notes : [],
  };
}

function listMarkup(items) {
  if (!items?.length) return "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderDraftBody(draft, decision) {
  const copy = copyTextForDraft(draft, decision);
  const hashtags = (copy.hashtags || []).join(" ");

  return `
    <div class="admin-draft-card__copy">
      ${copy.hook ? `<p><strong>Hook</strong><span>${escapeHtml(copy.hook)}</span></p>` : ""}
      ${copy.caption ? `<p><strong>Caption</strong><span>${escapeHtml(copy.caption)}</span></p>` : ""}
      ${hashtags ? `<p><strong>Hashtags</strong><span>${escapeHtml(hashtags)}</span></p>` : ""}
      ${draft.marketingAngle ? `<p><strong>Marketing angle</strong><span>${escapeHtml(draft.marketingAngle)}</span></p>` : ""}
      ${draft.eventUrl ? `<p><strong>Event link</strong><a href="${escapeHtml(draft.eventUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(draft.eventUrl)}</a></p>` : ""}
      ${draft.geoTargeting ? `<p><strong>Geo rule</strong><span>${escapeHtml(draft.geoTargeting.rule)}</span></p>` : ""}
      ${copy.notes?.length ? `<p><strong>Fallback notes</strong><span>${escapeHtml(copy.notes.join(" "))}</span></p>` : ""}
      <p><strong>Asset brief</strong><span>${escapeHtml(draft.assetBrief || "n/a")}</span></p>
    </div>
    ${draft.script?.length ? `<div class="admin-script-block"><strong>Script</strong>${listMarkup(draft.script)}</div>` : ""}
    ${draft.frames?.length ? `<div class="admin-script-block"><strong>Story frames</strong>${listMarkup(draft.frames)}</div>` : ""}
    ${draft.slides?.length ? `<div class="admin-script-block"><strong>Slides</strong>${listMarkup(draft.slides)}</div>` : ""}
  `;
}

function renderDraftCard(draft, index) {
  const decision = getDecision(index);
  const copyMode = decision.copyMode || "local";
  const status = decision.status || "pending";
  const statusLabel = status.replace("_", " ");
  const canUseGeneral = Boolean(draft.fallbackCopy);

  return `
    <article class="admin-draft-card admin-draft-card--${escapeHtml(status)}">
      <div class="admin-draft-card__head">
        <div>
          <p class="panel-label">${escapeHtml(draft.channel || "social")} · ${escapeHtml(draft.format || "draft")}</p>
          <h3>${escapeHtml(draft.title || `Draft ${index + 1}`)}</h3>
        </div>
        <span class="admin-status-pill admin-status-pill--${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
      </div>

      <div class="admin-draft-card__meta">
        <span>${escapeHtml(draft.trigger || "draft")}</span>
        ${draft.locality ? `<span>${escapeHtml(draft.locality)}</span>` : ""}
        ${draft.sourceEventId ? `<span>event: ${escapeHtml(draft.sourceEventId)}</span>` : ""}
      </div>

      ${
        canUseGeneral
          ? `
            <div class="admin-copy-toggle" data-copy-toggle="${index}">
              <button class="${copyMode === "local" ? "is-active" : ""}" type="button" data-copy-mode="local">Geo/local copy</button>
              <button class="${copyMode === "general" ? "is-active" : ""}" type="button" data-copy-mode="general">General fallback</button>
            </div>
          `
          : ""
      }

      ${renderDraftBody(draft, decision)}

      <label class="admin-notes-field">
        <span>Public media URL for direct publishing</span>
        <input data-media-url="${index}" type="url" placeholder="https://.../approved-video-or-image.mp4" value="${escapeHtml(decision.mediaUrl || "")}" />
      </label>

      <label class="admin-notes-field">
        <span>Reviewer notes</span>
        <textarea data-review-notes="${index}" rows="3" placeholder="Optional edit notes before posting">${escapeHtml(decision.notes || "")}</textarea>
      </label>

      <div class="admin-draft-card__actions">
        <button class="button button--primary" type="button" data-decision="approved" data-index="${index}">Approve</button>
        <button class="button button--secondary" type="button" data-decision="needs_edits" data-index="${index}">Needs edits</button>
        <button class="button button--quiet" type="button" data-decision="rejected" data-index="${index}">Reject</button>
      </div>
    </article>
  `;
}

function decisionCounts(drafts) {
  return drafts.reduce(
    (counts, _draft, index) => {
      const status = getDecision(index).status || "pending";
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    },
    { all: drafts.length, pending: 0, approved: 0, needs_edits: 0, rejected: 0 }
  );
}

function renderSummary(drafts) {
  const counts = decisionCounts(drafts);
  els.summaryGrid.innerHTML = [
    ["All", counts.all],
    ["Pending", counts.pending],
    ["Approved", counts.approved],
    ["Needs edits", counts.needs_edits],
    ["Rejected", counts.rejected],
  ]
    .map(
      ([label, count]) => `
        <div class="admin-summary-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(count)}</strong>
        </div>
      `
    )
    .join("");

  const filters = [
    ["all", "All"],
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["needs_edits", "Needs edits"],
    ["rejected", "Rejected"],
  ];
  els.filterRow.innerHTML = filters
    .map(
      ([key, label]) => `
        <button class="${state.filter === key ? "is-active" : ""}" type="button" data-filter="${key}">
          ${escapeHtml(label)}
        </button>
      `
    )
    .join("");
}

function renderDashboard() {
  const queue = state.queuePayload?.queue;
  const drafts = queue?.ownedDrafts || [];

  els.queueTitle.textContent = "Social drafts";
  els.queueMeta.textContent = queue
    ? `Generated ${new Date(queue.generatedAt).toLocaleString("en-GB")} · ${drafts.length} drafts · ${state.queuePayload.sourceQueueFile}`
    : "No queue loaded.";

  renderSummary(drafts);

  const visibleDrafts = drafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ index }) => state.filter === "all" || getDecision(index).status === state.filter);

  els.draftGrid.innerHTML = visibleDrafts.length
    ? visibleDrafts.map(({ draft, index }) => renderDraftCard(draft, index)).join("")
    : '<article class="events-empty"><p class="panel-label">No drafts</p><h3>No drafts match this filter.</h3></article>';
}

async function loadQueue() {
  const res = await fetch(QUEUE_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Could not load data/social-approval-queue.json. Publish a queue first.");
  }

  state.queuePayload = await res.json();
  loadDecisions();
  renderDashboard();
  setDashboardStatus("Queue loaded. Approvals are saved on this browser and can be exported.", "success");
}

function exportDecisions() {
  const payload = {
    exportedAt: new Date().toISOString(),
    adminEmail: state.authedEmail,
    queueFile: state.queuePayload?.sourceQueueFile,
    queueGeneratedAt: state.queuePayload?.queue?.generatedAt,
    decisions: state.decisions,
    approvedDrafts: (state.queuePayload?.queue?.ownedDrafts || [])
      .map((draft, index) => ({ draft, index, decision: getDecision(index) }))
      .filter(({ decision }) => decision.status === "approved"),
  };

  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `triangulate-social-decisions-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setDashboardStatus("Decisions exported.", "success");
}

async function publishApproved() {
  const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) {
    setDashboardStatus("Sign in again before publishing.", "error");
    return;
  }

  const drafts = state.queuePayload?.queue?.ownedDrafts || [];
  const approvedDrafts = drafts
    .map((draft, index) => ({ draft, index, decision: getDecision(index) }))
    .filter(({ decision }) => decision.status === "approved");

  if (!approvedDrafts.length) {
    setDashboardStatus("Approve at least one draft before publishing.", "error");
    return;
  }

  els.publish.disabled = true;
  setDashboardStatus("Sending approved drafts to the publishing backend...", "info");

  try {
    const res = await fetch(PUBLISH_FUNCTION_URL, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queueFile: state.queuePayload?.sourceQueueFile,
        queueGeneratedAt: state.queuePayload?.queue?.generatedAt,
        drafts: approvedDrafts,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new Error(body.error || "Publishing backend returned an error.");
    }

    const summary = (body.results || [])
      .map((result) => `${result.platform || "platform"}: ${result.status}`)
      .join(" · ");
    setDashboardStatus(summary || "Publishing request completed.", "success");
  } catch (error) {
    setDashboardStatus(error instanceof Error ? error.message : "Could not publish approved drafts.", "error");
  } finally {
    els.publish.disabled = false;
  }
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = els.email.value.trim().toLowerCase();
    if (email !== ADMIN_EMAIL) {
      setLoginStatus(`Use the approved admin email: ${ADMIN_EMAIL}.`, "error");
      return;
    }

    els.loginForm.querySelector("button").disabled = true;
    setLoginStatus("Sending login link...", "info");
    try {
      await sendMagicLink(email);
      setLoginStatus("Login link sent. Open it from the admin email inbox.", "success");
    } catch (error) {
      setLoginStatus(error instanceof Error ? error.message : "Could not send login link.", "error");
    } finally {
      els.loginForm.querySelector("button").disabled = false;
    }
  });

  els.signOut.addEventListener("click", () => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    setAccessState("");
    setLoginStatus("Signed out.", "success");
  });

  els.export.addEventListener("click", exportDecisions);
  els.publish.addEventListener("click", publishApproved);

  els.reset.addEventListener("click", () => {
    localStorage.removeItem(decisionsKey());
    state.decisions = {};
    renderDashboard();
    setDashboardStatus("Local decisions cleared for this queue.", "success");
  });

  els.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    renderDashboard();
  });

  els.draftGrid.addEventListener("click", (event) => {
    const decisionButton = event.target.closest("[data-decision]");
    if (decisionButton) {
      const index = Number(decisionButton.dataset.index);
      const notes = els.draftGrid.querySelector(`[data-review-notes="${index}"]`)?.value || "";
      updateDecision(index, { status: decisionButton.dataset.decision, notes });
      return;
    }

    const copyButton = event.target.closest("[data-copy-mode]");
    if (copyButton) {
      const parent = copyButton.closest("[data-copy-toggle]");
      const index = Number(parent.dataset.copyToggle);
      updateDecision(index, { copyMode: copyButton.dataset.copyMode });
    }
  });

  els.draftGrid.addEventListener("input", (event) => {
    const field = event.target.closest("[data-review-notes], [data-media-url]");
    if (!field) return;
    const index = Number(field.dataset.reviewNotes || field.dataset.mediaUrl);
    const id = draftId(index);
    const patch = field.dataset.mediaUrl ? { mediaUrl: field.value } : { notes: field.value };
    state.decisions[id] = {
      ...getDecision(index),
      ...patch,
    };
    saveDecisions();
  });
}

async function init() {
  bindEvents();
  const authed = await restoreSession();
  if (!authed) return;

  try {
    await loadQueue();
  } catch (error) {
    setDashboardStatus(error instanceof Error ? error.message : "Could not load queue.", "error");
  }
}

void init();
