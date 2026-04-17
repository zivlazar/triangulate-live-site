import { CONTACT_FUNCTION_NAME, SUPABASE_KEY, SUPABASE_URL } from "./site-config.js";
import {
  getAnalyticsConsent,
  getTrackingContext,
  initSiteCore,
  setAnalyticsConsent,
  trackWebsiteEvent,
} from "./site-core.js";

function countWords(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function setStatus(type, message) {
  const status = document.getElementById("contact-form-status");
  if (!status) return;
  status.className = `contact-form__status is-${type}`;
  status.textContent = message;
}

function updateWordCount() {
  const field = document.getElementById("contact-query");
  const counter = document.getElementById("contact-word-count");
  if (!field || !counter) return;

  const used = countWords(field.value);
  counter.textContent = `${used}/500 words`;
  counter.classList.toggle("is-over", used > 500);
}

async function submitFeedback(payload) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${CONTACT_FUNCTION_NAME}`, {
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
    throw new Error(data?.error || "Unable to send your message right now.");
  }

  return data;
}

function bindContactForm() {
  const form = document.getElementById("contact-form");
  const query = document.getElementById("contact-query");
  const analyticsConsent = document.getElementById("contact-analytics-consent");

  if (!form || !query) return;

  const submitButton = form.querySelector("button[type=\"submit\"]");

  query.addEventListener("input", updateWordCount);
  updateWordCount();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("neutral", "Sending your message…");

    const formData = new FormData(form);
    const queryText = String(formData.get("query") || "").trim();
    const wordCount = countWords(queryText);

    if (wordCount > 500) {
      setStatus("error", "Your query must be 500 words or fewer.");
      return;
    }

    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending…";
    }

    const analyticsApproved =
      analyticsConsent instanceof HTMLInputElement ? analyticsConsent.checked : getAnalyticsConsent() === "accepted";

    if (analyticsApproved) {
      setAnalyticsConsent("accepted");
      await initSiteCore();
    }

    const payload = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      phoneNumber: String(formData.get("phoneNumber") || "").trim(),
      companyName: String(formData.get("companyName") || "").trim(),
      query: queryText,
      analyticsConsent: analyticsApproved,
      responseConsent: String(formData.get("responseConsent") || "") === "on",
      sourcePage: window.location.pathname,
      referrer: document.referrer || "",
      trackingContext: getTrackingContext(),
    };

    try {
      await submitFeedback(payload);
      trackWebsiteEvent("contact_form_submitted", {
        source_page: window.location.pathname,
        has_phone_number: Boolean(payload.phoneNumber),
        has_company_name: Boolean(payload.companyName),
        linked_player_id: analyticsApproved ? payload.trackingContext.linkedPlayerId || undefined : undefined,
      });
      form.reset();
      updateWordCount();
      setStatus("success", "Thanks — your message has been sent and a confirmation email is on its way.");
    } catch (error) {
      setStatus("error", error instanceof Error ? error.message : "Unable to send your message right now.");
    } finally {
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.textContent = "Send message";
      }
    }
  });
}

bindContactForm();
