import "./site-core.js";
import { leaderboardScopes, leaderboardTimes } from "./content.js";
import { SUPABASE_KEY, SUPABASE_URL } from "./site-config.js";

const TIME_TO_PERIOD = {
  daily: "today",
  weekly: "week",
  all_time: "all_time",
};

const SCOPE_LABELS = {
  games: "Events",
  local: "Local players",
  city: "City players",
  global: "Global players",
};

function getViewerId() {
  return localStorage.getItem("triangulate_player_id") || "web-public-viewer";
}

async function sbRpc(fn, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Supabase ${res.status}`);
  }

  return res.json();
}

async function fetchBracket(period) {
  const data = await sbRpc("get_my_bracket", {
    p_player_id: getViewerId(),
    p_period: period,
    p_include_test: true,
  });

  return (data || [])
    .slice()
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((row) => ({
      player_id: row.player_id,
      rank: row.rank ?? 999,
      name: row.nickname || "Unknown",
      score: row.score || 0,
      rank_change: row.rank_change || 0,
      is_me: Boolean(row.is_me),
      city: row.city || "",
      country: row.country || "",
      last_event: row.last_event || "",
      local_area: row.local_area || "",
      last_event_date: row.last_event_date || "",
    }));
}

function locationValue(scope, entry) {
  switch (scope) {
    case "games":
      return entry.last_event || "Recent event";
    case "local":
      return entry.local_area || entry.city || "Your area";
    case "city":
      return entry.city || entry.country || "Nearby";
    case "global":
      return entry.country || "Global";
    default:
      return "Recent";
  }
}

function updateText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function renderTabs(containerId, items, activeKey, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = items
    .map(
      (item) => `
        <button class="filter-chip${item.key === activeKey ? " is-active" : ""}" type="button" data-key="${item.key}">
          ${item.label}
        </button>
      `
    )
    .join("");

  container.addEventListener("click", (event) => {
    const target = event.target.closest("[data-key]");
    if (!target) return;
    onSelect(target.dataset.key);
  });
}

function renderLeaderboardRows(players, scope) {
  const container = document.getElementById("leaderboard-list");
  if (!container) return;

  if (!players.length) {
    container.innerHTML = '<div class="leaderboard-row"><p class="leaderboard-row__meta">No players yet.</p></div>';
    return;
  }

  container.innerHTML = players
    .slice(0, 6)
    .map((player, index) => {
      const movement =
        player.rank_change > 0
          ? `▲ ${player.rank_change}`
          : player.rank_change < 0
            ? `▼ ${Math.abs(player.rank_change)}`
            : "Steady";

      return `
        <article class="leaderboard-row">
          <span class="leaderboard-row__rank">${index + 1}</span>
          <div>
            <p class="leaderboard-row__name">${player.is_me ? "You" : player.name}</p>
            <p class="leaderboard-row__meta">${locationValue(scope, player)} · ${player.last_event_date || "Recent"}</p>
          </div>
          <div class="leaderboard-row__score">
            <strong>${player.score.toLocaleString()}</strong>
            <span>${movement}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderBiggestMover(players) {
  const container = document.getElementById("leaderboard-mover");
  if (!container) return;

  const mover = players
    .filter((player) => player.rank_change !== 0)
    .slice()
    .sort((a, b) => Math.abs(b.rank_change) - Math.abs(a.rank_change))[0];

  if (!mover) {
    container.innerHTML = "<strong>No movement yet</strong><span>Fresh games will show rank jumps here.</span>";
    return;
  }

  const direction = mover.rank_change > 0 ? "Up" : "Down";
  container.innerHTML = `
    <strong>${mover.is_me ? "You" : mover.name}</strong>
    <span>${direction} ${Math.abs(mover.rank_change)} places · ${mover.score.toLocaleString()} points</span>
  `;
}

function renderActivity(players, scope) {
  const container = document.getElementById("leaderboard-activity");
  if (!container) return;

  const topPlayer = players[0];
  const recentEvent = players.find((player) => player.last_event)?.last_event || "New sessions landing";
  const topLocation = topPlayer ? locationValue(scope, topPlayer) : "Your area";

  container.innerHTML = `
    <div class="stack-card__item">
      <strong>Top spot</strong>
      <p>${topLocation}</p>
    </div>
    <div class="stack-card__item">
      <strong>Recent event</strong>
      <p>${recentEvent}</p>
    </div>
    <div class="stack-card__item">
      <strong>Top player</strong>
      <p>${topPlayer ? (topPlayer.is_me ? "You" : topPlayer.name) : "Waiting for scores"}</p>
    </div>
  `;
}

function updatedLabel() {
  return `Updated ${new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function initLeaderboard() {
  if (!document.getElementById("leaderboard-list")) {
    return;
  }

  let scope = "local";
  let time = "daily";

  renderTabs("leaderboard-scope-tabs", leaderboardScopes, scope, (nextScope) => {
    scope = nextScope;
    refresh();
  });

  renderTabs("leaderboard-time-tabs", leaderboardTimes, time, (nextTime) => {
    time = nextTime;
    refresh();
  });

  async function refresh() {
    try {
      updateText("leaderboard-title", SCOPE_LABELS[scope]);
      updateText("leaderboard-updated", "Refreshing…");

      const bracket = await fetchBracket(TIME_TO_PERIOD[time]);
      renderLeaderboardRows(bracket, scope);
      renderBiggestMover(bracket);
      renderActivity(bracket, scope);
      updateText("leaderboard-updated", updatedLabel());
      updateText("leaderboard-title", `${SCOPE_LABELS[scope]} · ${leaderboardTimes.find((item) => item.key === time)?.label || ""}`);
    } catch (error) {
      console.error("Leaderboard fetch error:", error);
      const container = document.getElementById("leaderboard-list");
      if (container) {
        container.innerHTML =
          '<div class="leaderboard-row"><p class="leaderboard-row__meta">Failed to load recent scores.</p></div>';
      }
      updateText("leaderboard-updated", "Couldn’t refresh just now");
    }
  }

  refresh();
  window.setInterval(refresh, 30000);
}
