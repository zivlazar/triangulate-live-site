import { ANALYTICS_CONFIG } from "./site-config.js";

const ANALYTICS_CONSENT_KEY = "triangulate_analytics_consent";
const WEB_VISITOR_KEY = "triangulate_web_visitor_id";
const PLAYER_ID_KEY = "triangulate_player_id";

let analyticsInitialised = false;
let pageViewTracked = false;
let mixpanelLoadPromise = null;
let googleLoadPromise = null;

export function ensureVisitorId() {
  const existing = localStorage.getItem(WEB_VISITOR_KEY);
  if (existing) return existing;

  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  localStorage.setItem(WEB_VISITOR_KEY, id);
  return id;
}

export function captureLinkedPlayerIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const playerId = params.get("player_id") || params.get("triangulate_player_id");
  if (playerId) {
    localStorage.setItem(PLAYER_ID_KEY, playerId);
  }
  return localStorage.getItem(PLAYER_ID_KEY);
}

export function getTrackingContext() {
  return {
    webVisitorId: ensureVisitorId(),
    linkedPlayerId: localStorage.getItem(PLAYER_ID_KEY),
    pagePath: window.location.pathname,
  };
}

export function getAnalyticsConsent() {
  return localStorage.getItem(ANALYTICS_CONSENT_KEY);
}

export function setAnalyticsConsent(value) {
  localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
}

function analyticsConfigured() {
  return Boolean(ANALYTICS_CONFIG.googleMeasurementId || ANALYTICS_CONFIG.mixpanelToken);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function loadGoogleAnalytics() {
  if (!ANALYTICS_CONFIG.googleMeasurementId) return Promise.resolve();
  if (googleLoadPromise) return googleLoadPromise;

  googleLoadPromise = loadScript(
    `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS_CONFIG.googleMeasurementId)}`
  ).then(() => {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", ANALYTICS_CONFIG.googleMeasurementId, {
      anonymize_ip: true,
      send_page_view: false,
    });
  });

  return googleLoadPromise;
}

function loadMixpanel() {
  if (!ANALYTICS_CONFIG.mixpanelToken) return Promise.resolve();
  if (mixpanelLoadPromise) return mixpanelLoadPromise;

  mixpanelLoadPromise = loadScript("https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js").then(() => {
    if (!window.mixpanel) return;
    window.mixpanel.init(ANALYTICS_CONFIG.mixpanelToken, {
      persistence: "localStorage",
      track_pageview: false,
      ignore_dnt: false,
    });

    const context = getTrackingContext();
    window.mixpanel.identify(context.webVisitorId);
    window.mixpanel.register({
      web_visitor_id: context.webVisitorId,
      linked_player_id: context.linkedPlayerId || undefined,
    });
  });

  return mixpanelLoadPromise;
}

function renderConsentBanner() {
  if (!analyticsConfigured()) return;
  if (document.querySelector("[data-analytics-banner]")) return;
  if (getAnalyticsConsent()) return;

  const banner = document.createElement("div");
  banner.className = "analytics-banner";
  banner.setAttribute("data-analytics-banner", "true");
  banner.innerHTML = `
    <div class="analytics-banner__copy">
      <strong>Analytics consent</strong>
      <p>Triangulate uses consent-based website analytics to understand page visits and contact-form activity. We do not use your phone number as an automatic tracking identifier.</p>
    </div>
    <div class="analytics-banner__actions">
      <button class="button button--dark analytics-banner__button" type="button" data-consent-choice="accept">Accept</button>
      <button class="button button--ghost analytics-banner__button" type="button" data-consent-choice="decline">Decline</button>
    </div>
  `;

  banner.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-consent-choice]");
    if (!button) return;

    const choice = button.dataset.consentChoice;
    setAnalyticsConsent(choice === "accept" ? "accepted" : "declined");
    banner.remove();

    if (choice === "accept") {
      await initialiseAnalytics();
      trackWebsiteEvent("website_consent_granted", {});
      trackPageView();
    }
  });

  document.body.appendChild(banner);
}

async function initialiseAnalytics() {
  if (analyticsInitialised || getAnalyticsConsent() !== "accepted") return;
  analyticsInitialised = true;
  await Promise.all([loadGoogleAnalytics(), loadMixpanel()]);
}

function trackPageView() {
  if (pageViewTracked || getAnalyticsConsent() !== "accepted") return;
  pageViewTracked = true;
  trackWebsiteEvent("page_view", {
    page_title: document.title,
    page_path: window.location.pathname,
  });
}

export function trackWebsiteEvent(name, properties = {}) {
  if (getAnalyticsConsent() !== "accepted") return;

  const payload = {
    ...getTrackingContext(),
    ...properties,
  };

  if (window.gtag && ANALYTICS_CONFIG.googleMeasurementId) {
    window.gtag("event", name, payload);
  }

  if (window.mixpanel && ANALYTICS_CONFIG.mixpanelToken) {
    window.mixpanel.track(name, payload);
  }
}

export async function initSiteCore() {
  captureLinkedPlayerIdFromUrl();
  ensureVisitorId();

  if (!analyticsConfigured()) return;

  if (getAnalyticsConsent() === "accepted") {
    await initialiseAnalytics();
    trackPageView();
    return;
  }

  renderConsentBanner();
}

void initSiteCore();

