import "./site-core.js";
import { leaderboardFilters, leaderboardScopes } from "./content.js";
import { GAME_SUPABASE_KEY, GAME_SUPABASE_URL } from "./site-config.js";

const VIEW_LABELS = {
  near_me: "Near Me",
  friends: "Friends",
  events: "Events",
  all_time: "All Time",
};

const FILTER_LABELS = {
  score: "Score",
  wins: "Wins",
  streak: "Streak",
  teams_played: "Teams",
};

function getViewerId() {
  return localStorage.getItem("triangulate_player_id") || "web-public-viewer";
}

async function sbRpc(fn, payload) {
  const res = await fetch(`${GAME_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: GAME_SUPABASE_KEY,
      Authorization: `Bearer ${GAME_SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Supabase ${res.status}`);
  }

  return res.json();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchBracket(view) {
  const data = await sbRpc("get_my_bracket", {
    p_player_id: getViewerId(),
    p_period: view === "all_time" ? "all_time" : "today",
    p_include_test: true,
  });

  return (data || [])
    .slice()
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((row) => ({
      row_type: "player",
      player_id: row.player_id,
      player_ids: [row.player_id],
      rank: row.rank ?? 999,
      name: row.nickname || "Unknown",
      score: Number(row.score || 0),
      wins: Number(row.wins || 0),
      current_streak: Number(row.current_streak || 0),
      team_formations: Number(row.team_games_completed || row.team_formations || 0),
      rank_change: Number(row.rank_change || 0),
      is_me: Boolean(row.is_me),
      city: row.city || "",
      country: row.country || "",
      last_event: row.last_event || "",
      local_area: row.local_area || "",
      last_event_date: row.last_event_date || "",
    }));
}

function metricValue(entry, filter) {
  if (filter === "score") return Number(entry.score || 0).toLocaleString();
  if (filter === "wins") return `${Number(entry.wins || 0).toLocaleString()} wins`;
  if (filter === "streak") return `${Number(entry.current_streak || 0).toLocaleString()} streak`;
  if (filter === "teams_played") return `${Number(entry.team_formations || 0).toLocaleString()} teams`;
  return Number(entry.score || 0).toLocaleString();
}

function sortValue(entry, filter) {
  if (filter === "wins") return Number(entry.wins || 0);
  if (filter === "streak") return Number(entry.current_streak || 0);
  if (filter === "teams_played") return Number(entry.team_formations || 0);
  return Number(entry.score || 0);
}

function rowMeta(view, entry, filter) {
  if (filter === "teams_played") {
    return "Games played together";
  }
  if (view === "events") {
    return entry.last_event || "Event ranking";
  }
  if (view === "friends") {
    return "Friends leaderboard";
  }
  if (view === "near_me") {
    return "Near Me leaderboard";
  }
  return "All Time leaderboard";
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

function renderLeaderboardRows(players, view, filter) {
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
        filter === "score"
          ? "Score"
          : filter === "teams_played"
            ? "Teams"
            : FILTER_LABELS[filter] || "Metric";

      return `
        <article class="leaderboard-row">
          <span class="leaderboard-row__rank">${escapeHtml(index + 1)}</span>
          <div>
            <p class="leaderboard-row__name">${escapeHtml(player.is_me ? "You" : player.name)}</p>
            <p class="leaderboard-row__meta">${escapeHtml(rowMeta(view, player, filter))}</p>
          </div>
          <div class="leaderboard-row__score">
            <strong>${escapeHtml(metricValue(player, filter))}</strong>
            <span>${escapeHtml(movement)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCurrentLeader(players, filter) {
  const container = document.getElementById("leaderboard-mover");
  if (!container) return;

  const leader = players[0];

  if (!leader) {
    container.innerHTML = "<strong>No leader yet</strong><span>Ranked results will appear here.</span>";
    return;
  }

  container.innerHTML = `
    <strong>${escapeHtml(leader.is_me ? "You" : leader.name)}</strong>
    <span>#1 · ${escapeHtml(metricValue(leader, filter))}</span>
  `;
}

function renderActivity(players, view, filter) {
  const container = document.getElementById("leaderboard-activity");
  if (!container) return;

  const topPlayer = players[0];
  const topName = topPlayer ? (topPlayer.is_me ? "You" : topPlayer.name) : "Waiting for scores";

  container.innerHTML = `
    <div class="stack-card__item">
      <strong>Category</strong>
      <p>${escapeHtml(VIEW_LABELS[view] || view)}</p>
    </div>
    <div class="stack-card__item">
      <strong>Metric</strong>
      <p>${escapeHtml(FILTER_LABELS[filter] || filter)}</p>
    </div>
    <div class="stack-card__item">
      <strong>Top row</strong>
      <p>${escapeHtml(topName)}</p>
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

  let view = "near_me";
  let filter = "score";

  renderTabs("leaderboard-scope-tabs", leaderboardScopes, view, (nextView) => {
    view = nextView;
    refresh();
  });

  renderTabs("leaderboard-filter-tabs", leaderboardFilters, filter, (nextFilter) => {
    filter = nextFilter;
    refresh();
  });

  async function refresh() {
    try {
      updateText("leaderboard-title", VIEW_LABELS[view]);
      updateText("leaderboard-updated", "Refreshing…");

      const bracket = await fetchBracket(view);
      const rows = bracket
        .slice()
        .sort((a, b) => {
          const valueDelta = sortValue(b, filter) - sortValue(a, filter);
          if (valueDelta !== 0) return valueDelta;
          return (a.rank ?? 999) - (b.rank ?? 999);
        });
      renderLeaderboardRows(rows, view, filter);
      renderCurrentLeader(rows, filter);
      renderActivity(rows, view, filter);
      updateText("leaderboard-updated", updatedLabel());
      updateText("leaderboard-title", `${VIEW_LABELS[view]} · ${FILTER_LABELS[filter]}`);
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
