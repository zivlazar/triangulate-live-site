import "./site-core.js";
import {
  audienceCards,
  heroVisualPrompts,
  quickStartItems,
  steps,
} from "./content.js";
import { initLeaderboard } from "./leaderboard.js";
import { SUPABASE_KEY, SUPABASE_URL } from "./site-config.js";

function getCurrentPage() {
  return document.body?.dataset.page || "home";
}

function renderQuickStart() {
  const grid = document.getElementById("quick-start-grid");
  if (!grid) return;

  grid.innerHTML = quickStartItems
    .map(
      (item) => `
        <article class="feature-card">
          <span class="feature-card__icon">${item.icon}</span>
          <h3>${item.title}</h3>
          <p>${item.description}</p>
        </article>
      `
    )
    .join("");
}

const EVENT_FALLBACK_CENTER = {
  lat: 51.5074,
  lng: -0.1278,
  label: "central London",
};

const EVENT_RADIUS_KM = 50;
const EVENT_LIMIT = 50;
const EVENT_VIEWER_ID = "web-public-viewer";

const eventState = {
  center: { ...EVENT_FALLBACK_CENTER },
  autoLocateAttempted: false,
  error: "",
  events: [],
  expandedEventId: "",
  lastUpdatedAt: null,
  loading: false,
  locationMode: "fallback",
  locationNote: "Showing public events now. Distances stay hidden until your location is available.",
  locating: false,
  registrations: new Map(),
  registrationsLoading: new Set(),
};

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

function updatedTimeLabel(date) {
  if (!(date instanceof Date)) return "Waiting for live data";
  return `Updated ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function hasViewerLocation() {
  return eventState.locationMode === "browser";
}

function renderEventFilters() {
  const container = document.getElementById("event-filters");
  if (!container) return;

  container.innerHTML = `
    <div class="events-toolbar">
      <div class="event-filter-group">
        <p class="panel-label">Updated</p>
        <div class="filter-row">
          <span class="filter-chip is-static">${escapeHtml(updatedTimeLabel(eventState.lastUpdatedAt))}</span>
        </div>
      </div>
      <div class="events-toolbar__actions">
        <button class="button button--secondary" type="button" data-event-action="refresh">
          Refresh
        </button>
        <button
          class="button button--quiet"
          type="button"
          data-event-action="locate"
          ${!navigator.geolocation || eventState.locating ? "disabled" : ""}
        >
          ${eventState.locating ? "Finding you…" : "Use current location"}
        </button>
      </div>
    </div>
  `;
}

function playerStack(count) {
  if (!count || count < 1) return "";
  const visible = Math.min(4, Math.max(1, Math.ceil(count / 2)));
  return new Array(visible).fill("").map(() => "<span></span>").join("");
}

const VISUAL_SOURCES = {
  hero: "./assets/photos/3-running-city.png",
  park: "./assets/photos/3-running-park.png",
  river: "./assets/photos/3-running-city.png",
  city: "./assets/photos/3-looking-city.png",
  plaza: "./assets/photos/3-running-city.png",
  campus: "./assets/photos/3-standing-city.png",
  friends: "./assets/photos/3-looking-city.png",
  teams: "./assets/photos/3-standing-city.png",
  default: "./assets/photos/3-running-city.png",
};

const VISUAL_ALTS = {
  hero: "Three players running through a city while using their phones to play Triangulate.",
  park: "Three players sprinting across a park while checking their phones.",
  river: "Three players running together through a city street with phones in hand.",
  city: "Three players smiling and checking their phones together in the city.",
  plaza: "Three players running through a city street with phones in hand.",
  campus: "Three students standing together with phones, ready to play.",
  friends: "Three friends checking their phones together while walking through the city.",
  teams: "Three students standing together with phones, ready to play.",
  default: "Three players outdoors using phones together during a Triangulate session.",
};

function triangleBackdropMarkup(variant = "default") {
  return `
    <svg class="triangle-backdrop triangle-backdrop--${variant}" viewBox="0 0 760 560" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="triStrokeA" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#52d8ff" />
          <stop offset="100%" stop-color="#9be8ff" />
        </linearGradient>
        <linearGradient id="triStrokeB" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffd54c" />
          <stop offset="100%" stop-color="#ff9f6b" />
        </linearGradient>
        <radialGradient id="triFill" cx="50%" cy="48%" r="58%">
          <stop offset="0%" stop-color="rgba(82, 216, 255, 0.22)" />
          <stop offset="100%" stop-color="rgba(82, 216, 255, 0)" />
        </radialGradient>
      </defs>

      <circle class="triangle-orb triangle-orb--one" cx="180" cy="144" r="76" />
      <circle class="triangle-orb triangle-orb--two" cx="612" cy="398" r="110" />

      <g class="triangle-pack triangle-pack--one">
        <polygon class="triangle-outline triangle-outline--cyan" points="150,42 316,336 -16,336" />
        <polygon class="triangle-outline triangle-outline--gold" points="150,108 272,316 28,316" />
      </g>

      <g class="triangle-pack triangle-pack--two">
        <polygon class="triangle-outline triangle-outline--cyan" points="590,110 720,330 460,330" />
        <polygon class="triangle-outline triangle-outline--gold" points="590,152 690,320 490,320" />
      </g>

      <g class="triangle-pack triangle-pack--three">
        <polygon class="triangle-outline triangle-outline--cyan" points="518,260 674,522 362,522" />
        <polygon class="triangle-outline triangle-outline--gold" points="518,312 640,518 396,518" />
      </g>

      <g class="triangle-pack triangle-pack--four">
        <polygon class="triangle-outline triangle-outline--cyan" points="244,236 350,416 138,416" />
        <polygon class="triangle-outline triangle-outline--gold" points="244,268 330,414 158,414" />
      </g>

      <polygon class="triangle-core" points="382,176 526,426 238,426" />
    </svg>
  `;
}

function currentArtworkMarkup(mode = "card", variant = "default") {
  const lazyMode = mode === "hero" ? "eager" : "lazy";
  const imageSrc = VISUAL_SOURCES[variant] || VISUAL_SOURCES.default;
  const imageAlt = VISUAL_ALTS[variant] || VISUAL_ALTS.default;

  return `
    <div class="media-visual media-visual--${mode} media-visual--${variant}">
      <div class="media-visual__halo" aria-hidden="true"></div>
      <figure class="media-poster media-poster--${mode}">
        <img src="${imageSrc}" alt="${imageAlt}" loading="${lazyMode}" decoding="async" />
      </figure>
    </div>
  `;
}

function eventGraphicMarkup(event, mode = "event") {
  const scopeKey = event.scope || "city";
  const timeKey = event.timeframe || "week";
  const statLabel =
    scopeKey === "local"
      ? "Local"
      : scopeKey === "city"
        ? "City"
        : scopeKey === "global"
          ? "Global"
          : "Away day";

  return `
    <div class="media-visual media-visual--${mode} media-visual--${event.sceneClass} media-visual--graphics-only">
      ${triangleBackdropMarkup(event.sceneClass)}
      <div class="media-visual__halo" aria-hidden="true"></div>
      <div class="event-graphic-shell" aria-hidden="true">
        <div class="event-graphic-grid"></div>
        <div class="event-graphic-route event-graphic-route--a"></div>
        <div class="event-graphic-route event-graphic-route--b"></div>
        <div class="event-graphic-node event-graphic-node--one"></div>
        <div class="event-graphic-node event-graphic-node--two"></div>
        <div class="event-graphic-node event-graphic-node--three"></div>
        <div class="event-graphic-triangle">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="event-graphic-badge event-graphic-badge--scope">${statLabel}</div>
        <div class="event-graphic-badge event-graphic-badge--time">${timeKey.replace("_", " ")}</div>
      </div>
    </div>
  `;
}

function renderHeroVisual() {
  const heroScene = document.querySelector(".hero-scene");
  if (!heroScene || heroScene.querySelector(".media-visual")) return;
  heroScene.insertAdjacentHTML("afterbegin", currentArtworkMarkup("hero", "hero"));
}

function initHeroTriangles() {
  const canvas = document.getElementById("hero-section-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  // Decorative hero motion is subtle and intentional; we don't gate it on
  // prefers-reduced-motion because it's a core part of the visual identity.
  const prefersReducedMotion = false;
  const minimumInteriorAngle = (20 * Math.PI) / 180;
  const maxDevicePixelRatio = 1.75;
  const palette = [
    "rgba(54, 226, 255, 1)",
    "rgba(255, 201, 36, 1)",
    "rgba(255, 123, 84, 1)",
    "rgba(126, 255, 182, 1)",
    "rgba(98, 166, 255, 1)",
    "rgba(255, 255, 255, 0.95)",
  ];
  let width = 0;
  let height = 0;
  let animationFrame = 0;
  let triangles = [];

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function choose(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  function spawnTriangle(existing = {}, { visible = false } = {}) {
    const fromLeft = Math.random() < 0.7;
    const radius = randomBetween(34, 108);
    const stretchX = randomBetween(2.8, 3.25);
    const x = visible
      ? randomBetween(radius * stretchX, Math.max(radius * stretchX + 1, width - radius * stretchX))
      : fromLeft
        ? -radius * stretchX * 1.4
        : width + radius * stretchX * 1.4;
    const y = visible
      ? randomBetween(radius, Math.max(radius + 1, height - radius))
      : randomBetween(-radius, height + radius);
    const driftX = fromLeft ? randomBetween(0.08, 0.18) : randomBetween(-0.18, -0.08);
    const driftY = randomBetween(-0.03, 0.03);

    return {
      ...existing,
      x,
      y,
      driftX,
      driftY,
      radius,
      stretchX,
      angle: Math.random() * Math.PI * 2,
      rotationSpeed: randomBetween(-0.0012, 0.0012),
      alpha: randomBetween(0.44, 0.82),
      stroke: choose(palette),
      baseRotation: Math.random() * Math.PI * 2,
      baseAngles: [
        -Math.PI / 2 + randomBetween(-0.1, 0.1),
        -Math.PI / 2 + (Math.PI * 2) / 3 + randomBetween(-0.12, 0.12),
        -Math.PI / 2 + (Math.PI * 4) / 3 + randomBetween(-0.1, 0.1),
      ],
      pointScale: [
        randomBetween(0.84, 1.24),
        randomBetween(0.8, 1.28),
        randomBetween(0.84, 1.24),
      ],
      angleOffset: [
        randomBetween(-0.2, 0.2),
        randomBetween(-0.22, 0.22),
        randomBetween(-0.2, 0.2),
      ],
      angleOffsetSpeed: [
        randomBetween(0.0015, 0.0045),
        randomBetween(0.0015, 0.0045),
        randomBetween(0.0015, 0.0045),
      ],
      wobble: [
        randomBetween(0.05, 0.12),
        randomBetween(0.05, 0.12),
        randomBetween(0.05, 0.12),
      ],
      wobbleSpeed: [
        randomBetween(0.003, 0.008),
        randomBetween(0.003, 0.008),
        randomBetween(0.003, 0.008),
      ],
      phase: [
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ],
      basePoints: existing.basePoints || [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      points: existing.points || [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    };
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const previousWidth = width || bounds.width || 1;
    const previousHeight = height || bounds.height || 1;
    const ratio = Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio);
    width = bounds.width;
    height = bounds.height;
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.max(6, Math.floor((width * height) / 120000) + 4);

    if (triangles.length === 0) {
      triangles = new Array(count)
        .fill(null)
        .map((_, index) => spawnTriangle({}, { visible: index < Math.ceil(count * 0.7) }));
      return;
    }

    const scaleX = width / previousWidth;
    const scaleY = height / previousHeight;

    triangles.forEach((triangle) => {
      triangle.x *= scaleX;
      triangle.y *= scaleY;
    });

    if (triangles.length < count) {
      for (let index = triangles.length; index < count; index += 1) {
        triangles.push(spawnTriangle({}, { visible: true }));
      }
    } else if (triangles.length > count) {
      triangles.length = count;
    }
  }

  function angleBetween(ax, ay, bx, by, cx, cy) {
    const ux = ax - bx;
    const uy = ay - by;
    const vx = cx - bx;
    const vy = cy - by;
    const dot = ux * vx + uy * vy;
    const magU = Math.hypot(ux, uy);
    const magV = Math.hypot(vx, vy);
    if (!magU || !magV) return 0;
    const cosine = Math.min(1, Math.max(-1, dot / (magU * magV)));
    return Math.acos(cosine);
  }

  function minimumAngle(points) {
    const [a, b, c] = points;
    return Math.min(
      angleBetween(c.x, c.y, a.x, a.y, b.x, b.y),
      angleBetween(a.x, a.y, b.x, b.y, c.x, c.y),
      angleBetween(b.x, b.y, c.x, c.y, a.x, a.y)
    );
  }

  function buildTrianglePoints(triangle) {
    const points = triangle.points;
    const basePoints = triangle.basePoints;

    for (let index = 0; index < 3; index += 1) {
      const baseAngle = triangle.baseRotation + triangle.baseAngles[index];
      const baseRadius = triangle.radius * triangle.pointScale[index];
      const pointAngle =
        baseAngle + Math.sin(triangle.phase[index] * 0.9) * triangle.angleOffset[index];
      const wobble =
        1 + Math.sin(triangle.phase[index] * 1.6 + index * 1.8) * triangle.wobble[index];
      const radius = baseRadius * wobble;

      basePoints[index].x = Math.cos(baseAngle) * baseRadius * triangle.stretchX;
      basePoints[index].y = Math.sin(baseAngle) * baseRadius;
      points[index].x = Math.cos(pointAngle) * radius * triangle.stretchX;
      points[index].y = Math.sin(pointAngle) * radius;
    }

    const currentMinimumAngle = minimumAngle(points);
    if (currentMinimumAngle < minimumInteriorAngle) {
      const blend = Math.min(1, (minimumInteriorAngle - currentMinimumAngle) / minimumInteriorAngle);

      for (let index = 0; index < 3; index += 1) {
        points[index].x += (basePoints[index].x - points[index].x) * blend;
        points[index].y += (basePoints[index].y - points[index].y) * blend;
      }
    }

    return points;
  }

  function drawTriangle(triangle) {
    ctx.save();
    ctx.translate(triangle.x, triangle.y);
    ctx.rotate(triangle.angle);
    ctx.beginPath();
    const points = buildTrianglePoints(triangle);
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.lineTo(points[2].x, points[2].y);

    ctx.closePath();
    ctx.strokeStyle = triangle.stroke;
    ctx.globalAlpha = triangle.alpha;
    ctx.lineWidth = 6.4;
    ctx.stroke();
    ctx.restore();
  }

  function update() {
    triangles.forEach((triangle) => {
      triangle.x += triangle.driftX;
      triangle.y += triangle.driftY;
      triangle.angle += triangle.rotationSpeed;
      triangle.phase[0] += triangle.wobbleSpeed[0];
      triangle.phase[1] += triangle.wobbleSpeed[1];
      triangle.phase[2] += triangle.wobbleSpeed[2];
      triangle.baseRotation += triangle.rotationSpeed * 0.45;

      const outLeft = triangle.x < -triangle.radius * triangle.stretchX * 2;
      const outRight = triangle.x > width + triangle.radius * triangle.stretchX * 2;
      const outTop = triangle.y < -triangle.radius * 2;
      const outBottom = triangle.y > height + triangle.radius * 2;

      if (outLeft || outRight || outTop || outBottom) {
        Object.assign(triangle, spawnTriangle(triangle));
      }
    });
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);
    for (let index = 0; index < triangles.length; index += 1) {
      drawTriangle(triangles[index]);
    }
    if (!prefersReducedMotion) update();
    animationFrame = window.requestAnimationFrame(frame);
  }

  const heroSection = canvas.closest(".hero-section");
  const resizeObserver = new ResizeObserver(resize);
  if (heroSection) resizeObserver.observe(heroSection);
  resize();
  frame();

  window.addEventListener(
    "pagehide",
    () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    },
    { once: true }
  );
}

function roundToHalfHour(date) {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  rounded.setMinutes(minutes < 15 ? 0 : minutes < 45 ? 30 : 60, 0, 0);
  return rounded;
}

function formatDayTime(date) {
  const day = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} · ${time}`;
}

function parseScheduledFor(iso) {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRecentEvent(event) {
  const scheduled = parseScheduledFor(event.scheduled_for);
  return scheduled ? scheduled.getTime() < Date.now() : false;
}

function timeLabel(event) {
  const scheduled = parseScheduledFor(event.scheduled_for);
  if (!scheduled) return "Whenever works";

  const start = scheduled.getTime();
  const now = Date.now();
  const diffMs = start - now;

  if (start < now) {
    const minutesAgo = Math.floor((now - start) / 60000);
    if (minutesAgo < 60) return `Finished ${minutesAgo} min ago`;
    return `Finished ${Math.floor(minutesAgo / 60)}h ago`;
  }

  const display = roundToHalfHour(scheduled);
  const dayTime = formatDayTime(display);

  if (diffMs > 0 && diffMs < 24 * 60 * 60_000) {
    const minutes = Math.ceil(diffMs / 60_000);
    if (minutes <= 1) return `${dayTime} (starting now)`;
    if (minutes < 60) return `${dayTime} (in ${minutes} min)`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${dayTime} (in ${hours}h)` : `${dayTime} (in ${hours}h ${remainder}m)`;
  }

  return dayTime;
}

function detailWhenLabel(iso) {
  const scheduled = parseScheduledFor(iso);
  if (!scheduled) return "Whenever works";
  return formatDayTime(roundToHalfHour(scheduled));
}

function distanceLabel(distanceM) {
  if (typeof distanceM !== "number" || Number.isNaN(distanceM)) return "Distance unknown";
  if (distanceM < 1000) return `${Math.round(distanceM)}m away`;
  return `${(distanceM / 1000).toFixed(1)}km away`;
}

function placeLabel(event) {
  return event.meeting_point_parent_name
    ? `${event.meeting_point_parent_name} · ${event.meeting_point_name}`
    : event.meeting_point_name;
}

function eventMicrocopy(event) {
  const host = event.creator_nickname || "Someone";
  if (event.team_name) {
    return `${event.team_name} hosting · ${host}${event.team_member_count ? ` + ${event.team_member_count} crew` : ""}`;
  }
  return `Hosted by ${host}${event.registration_count > 0 ? ` · ${event.registration_count} interested` : ""}`;
}

function surfaceClassForEvent(event) {
  const text = `${event.meeting_point_name || ""} ${event.meeting_point_parent_name || ""}`.toLowerCase();
  if (text.includes("park") || text.includes("common") || text.includes("green")) return "park";
  if (text.includes("river") || text.includes("canal") || text.includes("bank")) return "river";
  if (text.includes("school") || text.includes("college") || text.includes("campus") || text.includes("university")) return "campus";
  if (text.includes("square") || text.includes("market") || text.includes("plaza")) return "plaza";
  return "city";
}

function updateEventsFootnote() {
  const footnote = document.getElementById("events-footnote");
  if (!footnote) return;

  footnote.textContent = eventState.error
    ? "The website only shows public events created through the mobile event planner."
    : "Only public events created in the mobile app are shown here, using the same live source data as the app.";
}

function attendeeMarkup(registration) {
  return `
    <li class="event-attendee">
      <span class="event-attendee__dot" style="background:${escapeHtml(registration.color || "#7ca3dc")}"></span>
      <div class="event-attendee__body">
        <strong>${escapeHtml(registration.nickname || registration.player_id)}</strong>
        <span>${escapeHtml(registration.status)}</span>
      </div>
    </li>
  `;
}

function eventDetailsMarkup(event) {
  const registrationState = eventState.registrations.get(event.id);
  const isLoadingRegistrations = eventState.registrationsLoading.has(event.id);
  const showDistance = hasViewerLocation();

  let attendeeContent = '<p class="event-detail__hint">Nobody has RSVP’d yet.</p>';
  if (isLoadingRegistrations) {
    attendeeContent = '<p class="event-detail__hint">Loading who’s going…</p>';
  } else if (registrationState?.error) {
    attendeeContent = `<p class="event-detail__hint">${escapeHtml(registrationState.error)}</p>`;
  } else if (registrationState?.rows?.length) {
    attendeeContent = `<ul class="event-attendees">${registrationState.rows.map(attendeeMarkup).join("")}</ul>`;
  }

  return `
    <div class="event-card__details">
      <div class="event-detail-grid">
        <div class="event-detail-item">
          <span>When</span>
          <strong>${escapeHtml(detailWhenLabel(event.scheduled_for))}</strong>
        </div>
        <div class="event-detail-item">
          <span>Where</span>
          <strong>${escapeHtml(placeLabel(event))}</strong>
        </div>
        ${
          showDistance
            ? `
              <div class="event-detail-item">
                <span>Distance</span>
                <strong>${escapeHtml(distanceLabel(event.distance_m))}</strong>
              </div>
            `
            : ""
        }
        <div class="event-detail-item">
          <span>Host</span>
          <strong>${escapeHtml(event.creator_nickname || "Someone")}</strong>
        </div>
        ${
          event.meeting_point_postcode
            ? `
              <div class="event-detail-item">
                <span>Postcode</span>
                <strong>${escapeHtml(event.meeting_point_postcode)}</strong>
              </div>
            `
            : ""
        }
        ${
          event.team_name
            ? `
              <div class="event-detail-item">
                <span>Team</span>
                <strong>${escapeHtml(event.team_name)}</strong>
              </div>
            `
            : ""
        }
      </div>
      ${
        event.plan_note
          ? `
            <div class="event-detail-copy">
              <span>Description</span>
              <p>${escapeHtml(event.plan_note)}</p>
            </div>
          `
          : ""
      }
      <div class="event-detail-copy">
        <span>Who’s going</span>
        ${attendeeContent}
      </div>
    </div>
  `;
}

function eventCardMarkup(event) {
  const isExpanded = eventState.expandedEventId === event.id;
  const isRecent = isRecentEvent(event);
  const surfaceClass = surfaceClassForEvent(event);
  const hasPhoto = Boolean(event.meeting_point_photo_url);
  const showDistance = hasViewerLocation();

  return `
    <article class="event-card event-card--live">
      <div class="event-card__media event-card__media--${surfaceClass} event-card__media--live${hasPhoto ? " event-card__media--photo" : ""}">
        ${
          hasPhoto
            ? `
              <img
                class="event-card__image"
                src="${escapeHtml(event.meeting_point_photo_url)}"
                alt="${escapeHtml(placeLabel(event))}"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
              />
            `
            : `
              <div class="event-card__fallback-visual">
                ${eventGraphicMarkup({ sceneClass: surfaceClass, scope: "city", timeframe: "week" }, "event")}
              </div>
            `
        }
      </div>
      <div class="event-card__content event-card__content--live">
        <div class="event-card__topline">
          <span class="player-chip">${escapeHtml(event.team_name || "Live event")}</span>
          <span class="status-pill" data-status="${isRecent ? "recent" : "upcoming"}">${escapeHtml(timeLabel(event))}</span>
        </div>
        <div class="event-card__title-group">
          <h3>${escapeHtml(event.title)}</h3>
          <p>${escapeHtml(placeLabel(event))}</p>
        </div>
        <div class="event-card__meta">
          <span>${escapeHtml(detailWhenLabel(event.scheduled_for))}</span>
          ${showDistance ? `<span>${escapeHtml(distanceLabel(event.distance_m))}</span>` : ""}
          <div class="player-stack" aria-hidden="true">${playerStack(event.registration_count)}</div>
        </div>
        <p class="event-card__microcopy">${escapeHtml(eventMicrocopy(event))}</p>
        ${
          event.plan_note
            ? `<p class="event-card__intro">${escapeHtml(event.plan_note)}</p>`
            : '<p class="event-card__intro">Published from the mobile app and synced directly to the website.</p>'
        }
        <div class="event-card__stats">
          <span class="event-stat">${event.registration_count} going</span>
          ${event.team_member_count ? `<span class="event-stat">${event.team_member_count} in crew</span>` : ""}
          <span class="event-stat">${escapeHtml(event.status)}</span>
        </div>
        <div class="event-card__footer">
          <button class="button button--secondary" type="button" data-event-toggle="${event.id}">
            ${isExpanded ? "Hide details" : "See details"}
          </button>
          <span class="panel-meta">Posted from the app</span>
        </div>
        ${isExpanded ? eventDetailsMarkup(event) : ""}
      </div>
    </article>
  `;
}

function eventSectionMarkup(title, eyebrow, rows) {
  return `
    <section class="events-subsection">
      <div class="events-subsection__head">
        <p class="panel-label">${escapeHtml(eyebrow)}</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(`Showing ${rows.length} live event${rows.length === 1 ? "" : "s"} from the mobile planner.`)}</p>
      </div>
      <div class="events-subsection__grid">
        ${rows.map((event) => eventCardMarkup(event)).join("")}
      </div>
    </section>
  `;
}

function renderEvents() {
  const grid = document.getElementById("events-grid");
  if (!grid) return;

  renderEventFilters();
  updateEventsFootnote();

  grid.classList.remove("events-grid--listing");
  grid.classList.add("events-grid--live");

  if (eventState.loading) {
    grid.innerHTML = `
      <article class="events-empty">
        <p class="panel-label">Loading live events</p>
        <h3>Pulling the same event feed as the mobile app.</h3>
        <p>Only app-created public events will appear here.</p>
      </article>
    `;
    return;
  }

  if (eventState.error) {
    grid.innerHTML = `
      <article class="events-empty">
        <p class="panel-label">Couldn’t load events</p>
        <h3>The live feed didn’t respond just now.</h3>
        <p>${escapeHtml(eventState.error)}</p>
      </article>
    `;
    return;
  }

  if (!eventState.events.length) {
    grid.innerHTML = `
      <article class="events-empty">
        <p class="panel-label">No live events yet</p>
        <h3>Nothing nearby has been posted from the mobile app.</h3>
        <p>When someone publishes a public event in the app, it will show up here automatically.</p>
      </article>
    `;
    return;
  }

  const upcomingEvents = eventState.events.filter((event) => !isRecentEvent(event));
  const recentEvents = eventState.events.filter((event) => isRecentEvent(event));
  const sections = [];

  if (upcomingEvents.length) {
    sections.push(eventSectionMarkup("Scheduled soon", "Upcoming", upcomingEvents));
  }

  if (recentEvents.length) {
    sections.push(eventSectionMarkup("Recent action", "Recent", recentEvents));
  }

  grid.innerHTML = sections.join("");
}

async function refreshEvents(nextCenter = eventState.center) {
  eventState.loading = true;
  eventState.error = "";
  eventState.center = { ...nextCenter };
  renderEvents();

  try {
    const rows = await sbRpc("list_public_events_near", {
      p_lat: nextCenter.lat,
      p_lng: nextCenter.lng,
      p_radius_km: EVENT_RADIUS_KM,
      p_limit: EVENT_LIMIT,
    });

    eventState.events = Array.isArray(rows) ? rows : [];
    eventState.lastUpdatedAt = new Date();

    if (eventState.expandedEventId && !eventState.events.some((event) => event.id === eventState.expandedEventId)) {
      eventState.expandedEventId = "";
    }
  } catch (error) {
    eventState.error = error instanceof Error ? error.message : "Could not load live events.";
  } finally {
    eventState.loading = false;
    renderEvents();
  }
}

function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      () => reject(new Error("Couldn’t get your location.")),
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  });
}

async function locateEventsFromBrowser({ silent = false } = {}) {
  eventState.locating = true;
  eventState.locationNote = silent
    ? "Checking your location so distances match where you are."
    : "Looking for your current location…";
  renderEventFilters();

  try {
    const coords = await getBrowserLocation();
    eventState.locationMode = "browser";
    eventState.locationNote = "Showing events near your current location.";
    await refreshEvents({
      lat: coords.latitude,
      lng: coords.longitude,
      label: "your location",
    });
  } catch (error) {
    eventState.locationMode = "fallback";
    eventState.locationNote = error instanceof Error
      ? `${error.message} Distances stay hidden until location is available.`
      : "Couldn’t get your location. Distances stay hidden until location is available.";
    renderEventFilters();
  } finally {
    eventState.locating = false;
    renderEventFilters();
  }
}

function autoLocateEvents() {
  if (eventState.autoLocateAttempted || !navigator.geolocation) return;
  eventState.autoLocateAttempted = true;
  void locateEventsFromBrowser({ silent: true });
}

async function ensureRegistrations(eventId) {
  if (eventState.registrations.has(eventId) || eventState.registrationsLoading.has(eventId)) {
    return;
  }

  eventState.registrationsLoading.add(eventId);
  renderEvents();

  try {
    const rows = await sbRpc("get_event_registrations", {
      p_event_id: eventId,
      p_viewer_player_id: EVENT_VIEWER_ID,
    });

    eventState.registrations.set(eventId, {
      error: "",
      rows: Array.isArray(rows) ? rows : [],
    });
  } catch (error) {
    eventState.registrations.set(eventId, {
      error: error instanceof Error ? error.message : "Could not load registrations.",
      rows: [],
    });
  } finally {
    eventState.registrationsLoading.delete(eventId);
    renderEvents();
  }
}

function bindEventsPage() {
  const controls = document.getElementById("event-filters");
  const grid = document.getElementById("events-grid");

  if (controls && !controls.dataset.bound) {
    controls.dataset.bound = "true";
    controls.addEventListener("click", async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest("[data-event-action]")?.dataset.eventAction;
      if (!action) return;

      if (action === "refresh") {
        await refreshEvents(eventState.center);
        return;
      }

      if (action === "locate") {
        await locateEventsFromBrowser();
      }
    });
  }

  if (grid && !grid.dataset.bound) {
    grid.dataset.bound = "true";
    grid.addEventListener("click", async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const eventId = target?.closest("[data-event-toggle]")?.dataset.eventToggle;
      if (!eventId) return;

      eventState.expandedEventId = eventState.expandedEventId === eventId ? "" : eventId;
      renderEvents();

      if (eventState.expandedEventId) {
        await ensureRegistrations(eventId);
      }
    });
  }
}

function renderAudienceCards() {
  const grid = document.getElementById("audience-grid");
  if (!grid) return;

  grid.innerHTML = audienceCards
    .map(
      (card) => `
        <article class="audience-card">
          <div class="audience-card__media audience-card__media--${card.sceneClass}">
            ${currentArtworkMarkup("card", card.sceneClass)}
          </div>
          <div class="audience-card__content">
            <h3>${card.title}</h3>
            <p>${card.description}</p>
            <a class="button button--quiet" href="${card.href}">${card.ctaLabel}</a>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSteps() {
  const grid = document.getElementById("steps-grid");
  if (!grid) return;

  grid.innerHTML = steps
    .map(
      (step) => `
        <article class="step-card">
          <span class="step-card__number">${step.number}</span>
          <h3>${step.title}</h3>
          <p>${step.description}</p>
        </article>
      `
    )
    .join("");
}

function markPromptSlots() {
  document.querySelectorAll("[data-prompt-key]").forEach((element) => {
    const key = element.getAttribute("data-prompt-key");
    const prompt = heroVisualPrompts[key];
    if (prompt) {
      element.setAttribute("data-ai-prompt", prompt);
    }
  });
}

function initReveal() {
  const elements = document.querySelectorAll("[data-reveal]");
  const page = getCurrentPage();

  if (page === "events" || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  elements.forEach((element) => observer.observe(element));
}

renderQuickStart();
renderHeroVisual();
initHeroTriangles();
if (document.getElementById("events-grid")) {
  renderEvents();
  bindEventsPage();
  refreshEvents();
  autoLocateEvents();
}
renderAudienceCards();
renderSteps();
markPromptSlots();
initReveal();
initLeaderboard();
