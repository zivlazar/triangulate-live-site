import { SUPABASE_KEY, SUPABASE_URL, WAITLIST_FUNCTION_NAME } from "./site-config.js";
import {
  getAnalyticsConsent,
  getTrackingContext,
  initSiteCore,
  setAnalyticsConsent,
} from "./site-core.js";

function setStatus(type, message) {
  const status = document.getElementById("waitlist-form-status");
  if (!status) return;
  status.className = `contact-form__status is-${type}`;
  status.textContent = message;
}

function readUtmFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source") || "",
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
    utmContent: params.get("utm_content") || "",
    utmTerm: params.get("utm_term") || "",
  };
}

async function submitWaitlist(payload) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${WAITLIST_FUNCTION_NAME}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Unable to join the waitlist right now.");
  }
  return data;
}

function bindWaitlistForm() {
  const form = document.getElementById("waitlist-form");
  const analyticsConsent = document.getElementById("waitlist-analytics-consent");
  if (!form) return;

  const submitButton = form.querySelector("button[type=\"submit\"]");
  const utm = readUtmFromUrl();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("neutral", "Joining the waitlist…");

    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.textContent = "Joining…";
    }

    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    if (!email) {
      setStatus("error", "Please enter your email.");
      restoreButton(submitButton);
      return;
    }

    const analyticsApproved =
      analyticsConsent instanceof HTMLInputElement ? analyticsConsent.checked : getAnalyticsConsent() === "accepted";

    if (analyticsApproved) {
      setAnalyticsConsent("accepted");
      await initSiteCore();
    }

    const payload = {
      email,
      name: String(formData.get("name") || "").trim(),
      phoneNumber: String(formData.get("phoneNumber") || "").trim(),
      city: String(formData.get("city") || "").trim(),
      ageConfirmed: String(formData.get("ageConfirmed") || "") === "on",
      responseConsent: String(formData.get("responseConsent") || "") === "on",
      analyticsConsent: analyticsApproved,
      ...utm,
      sourcePage: window.location.pathname,
      referrer: document.referrer || "",
      _hp: String(formData.get("_hp") || ""),
      trackingContext: getTrackingContext(),
    };

    let success = false;
    try {
      await submitWaitlist(payload);
      form.reset();
      setStatus(
        "success",
        "You're on the list. Check your email for a confirmation."
      );
      success = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to join the waitlist right now.";
      setStatus("error", message);
    } finally {
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.textContent = success ? "You're in ✓" : "Join the waitlist";
      }
    }
  });
}

initSiteCore().finally(bindWaitlistForm);
