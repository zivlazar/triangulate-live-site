import "./site-core.js";
import {
  audienceCards,
  eventSchedule,
  eventScopeFilters,
  eventTimeFilters,
  events,
  heroVisualPrompts,
  quickStartItems,
  steps,
  weeklyFeature,
} from "./content.js";
import { initLeaderboard } from "./leaderboard.js";

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

const eventFilterState = {
  scope: "local",
  time: "today",
};

function renderEventFilters() {
  const container = document.getElementById("event-filters");
  if (!container) return;

  container.innerHTML = `
    <div class="event-filter-group">
      <p class="panel-label">Where</p>
      <div class="filter-row">
        ${eventScopeFilters
          .map(
            (filter) => `
              <button
                class="filter-chip${filter.key === eventFilterState.scope ? " is-active" : ""}"
                type="button"
                data-filter-group="scope"
                data-filter-value="${filter.key}"
              >
                ${filter.label}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
    <div class="event-filter-group">
      <p class="panel-label">When</p>
      <div class="filter-row">
        ${eventTimeFilters
          .map(
            (filter) => `
              <button
                class="filter-chip${filter.key === eventFilterState.time ? " is-active" : ""}"
                type="button"
                data-filter-group="time"
                data-filter-value="${filter.key}"
              >
                ${filter.label}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function playerStack(count) {
  const visible = Math.min(4, Math.max(3, Math.ceil(count / 6)));
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
  const badgeLabel = mode === "hero" ? "Local asset photo" : "From assets/photos";
  const animatedBackdrop = triangleBackdropMarkup(variant);

  return `
    <div class="media-visual media-visual--${mode} media-visual--${variant}">
      ${animatedBackdrop}
      <div class="media-visual__halo" aria-hidden="true"></div>
      <figure class="media-poster media-poster--${mode}">
        <img src="${imageSrc}" alt="${imageAlt}" loading="${lazyMode}" decoding="async" />
      </figure>
      <div class="media-icon-badge">
        <span>${badgeLabel}</span>
      </div>
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

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

function eventCardMarkup(event, { featured = event.featured } = {}) {
  return `
    <article class="event-card ${featured ? "event-card--featured" : ""}">
      <div class="event-card__media event-card__media--${event.sceneClass}">
        ${eventGraphicMarkup(event, "event")}
      </div>
      <div class="event-card__content">
        <div class="event-card__topline">
          <span class="player-chip">${event.typeLabel}</span>
          <span class="status-pill" data-status="${event.statusKey}">${event.liveLabel}</span>
        </div>
        <div class="event-card__title-group">
          <h3>${event.name}</h3>
          <p>${event.location}</p>
        </div>
        <div class="event-card__meta">
          <span>${event.time}</span>
          <span>${event.distance}</span>
          <div class="player-stack" aria-hidden="true">${playerStack(event.players)}</div>
        </div>
        <p class="event-card__microcopy">${event.microcopy}</p>
        <p>${event.intro}</p>
        <div class="event-card__stats">
          <span class="event-stat">${event.players} joining</span>
          ${event.playersActive > 0 ? `<span class="event-stat">${event.playersActive} active</span>` : ""}
          ${event.teamsForming > 0 ? `<span class="event-stat">${event.teamsForming} teams forming</span>` : ""}
        </div>
        <div class="event-card__footer">
          <a class="button button--secondary" href="#final-cta">${event.ctaLabel}</a>
          <span class="panel-meta">${event.status}</span>
        </div>
      </div>
    </article>
  `;
}

function renderEvents() {
  const grid = document.getElementById("events-grid");
  if (!grid) return;

  renderEventFilters();

  const visibleEvents = events.filter(
    (event) => event.scope === eventFilterState.scope && event.timeframe === eventFilterState.time
  );

  grid.classList.add("events-grid--listing");

  if (visibleEvents.length === 0) {
    grid.innerHTML = `
      <article class="events-empty">
        <p class="panel-label">Nothing live here yet</p>
        <h3>Try a different event bracket.</h3>
        <p>Switch the location or time tabs to see more sessions in the same structure as the leaderboard.</p>
      </article>
    `;
    return;
  }

  grid.innerHTML = visibleEvents.map((event) => eventCardMarkup(event, { featured: false })).join("");
}

function bindEventFilters() {
  const container = document.getElementById("event-filters");
  if (!container) return;

  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter-group][data-filter-value]");
    if (!button) return;
    eventFilterState[button.dataset.filterGroup] = button.dataset.filterValue;
    renderEvents();
  });
}

function renderEventSchedule() {
  const feature = document.getElementById("event-schedule-feature");
  const container = document.getElementById("event-schedule-list");
  if (!container) return;

  if (feature) {
    feature.innerHTML = `
      <article class="event-schedule-feature__card">
        <div class="event-schedule-feature__media event-card__media--${weeklyFeature.sceneClass}">
          ${eventGraphicMarkup(weeklyFeature, "schedule")}
        </div>
        <div>
          <p class="panel-label">${weeklyFeature.label}</p>
          <h4>${weeklyFeature.name}</h4>
          <div class="event-schedule-feature__meta">
            <strong>${weeklyFeature.time}</strong>
            <p>${weeklyFeature.description}</p>
          </div>
        </div>
      </article>
    `;
  }

  container.innerHTML = eventSchedule
    .map(
      (item) => `
        <article class="event-schedule-item">
          <div class="event-schedule-item__media event-card__media--${item.sceneClass}">
            ${eventGraphicMarkup(item, "schedule")}
          </div>
          <div class="event-schedule-item__body">
            <div>
              <p class="event-schedule-day">${item.day}</p>
              <p class="event-schedule-time">${item.time}</p>
            </div>
            <strong>${item.name}</strong>
            <p>${item.blurb}</p>
          </div>
        </article>
      `
    )
    .join("");
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
renderEvents();
bindEventFilters();
renderEventSchedule();
renderAudienceCards();
renderSteps();
markPromptSlots();
initReveal();
initLeaderboard();
