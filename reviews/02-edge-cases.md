# Report 2 — Edge-Case Scenario Review

**Scope:** Realistic real-world conditions that aren't bugs in the strict sense but will degrade UX or fail silently.
**Date:** 2026-04-25

Each scenario describes the **trigger**, the **observed behaviour today**, and a **decision option**.

---

## EVENTS PAGE

### E-1. User denies geolocation permanently in their browser
- **Trigger:** User clicked "Block" on the auto-prompt (permanent for that origin), then comes back tomorrow.
- **Today:** [scripts/main.js:1018-1043](scripts/main.js#L1018-L1043) calls geolocation, instantly fails, and the location note becomes *"Couldn't get your location. Distances stay hidden until location is available."* — but the user has no clear path to fix it (browsers hide the unblock control behind site-info).
- **Options:**
  - **(A)** Detect `permission.state === "denied"` via the Permissions API and show an inline "Enable location in your browser settings to see distances" hint with a help link.
  - **(B)** Just keep showing the city-default events with no distance. (Today's behavior.)

### E-2. Two events with identical IDs (data race in the upstream RPC)
- **Trigger:** Backend returns duplicate rows (e.g. join blew up).
- **Today:** Both render as `<article data-event-id="…">` with the same ID. Click handler grabs the first one. Expand state may apply to both visually.
- **Options:**
  - **(A)** Dedupe by `id` in the client before render.
  - **(B)** Trust the RPC; ignore.

### E-3. Event missing required fields (e.g. no `meeting_point_name`, no `scheduled_for`)
- **Trigger:** Bad data, partial sync, schema drift.
- **Today:** [scripts/main.js:646-650](scripts/main.js#L646-L650) `placeLabel` returns `undefined` (when both `meeting_point_parent_name` and `meeting_point_name` are falsy, no fallback). [scripts/main.js:594-598](scripts/main.js#L594-L598) `parseScheduledFor` returns `null` → `timeLabel` says "Whenever works".
- **Options:**
  - **(A)** Add explicit fallbacks (e.g. `placeLabel` → "Location TBC").
  - **(B)** Skip cards that lack required data at render time.

### E-4. The event the user opened (`?event=XYZ`) isn't in the radius result
- **Trigger:** User shares a link to an event 100 km away; viewer is in London.
- **Today:** [scripts/main.js:978-985](scripts/main.js#L978-L985) — if the requested event isn't in the response, `expandedEventId` is cleared with no message. The user just sees "events near me" with no acknowledgement that the link they opened doesn't exist *for them*.
- **Options:**
  - **(A)** Re-fetch the specific event via a separate RPC (`get_public_event_by_id`) and prepend it to the list with a "Far from you" badge.
  - **(B)** Show a soft banner: *"This event isn't currently visible to you. Try expanding the search or check the original link."*
  - **(C)** Today's silent drop.

### E-5. The user's location is far from London but inside the radius of zero events
- **Trigger:** Auto-locate succeeds in, say, Manchester. There are no events within 50 km.
- **Today:** Empty state appears. No suggestion to expand the radius or see other cities.
- **Options:**
  - **(A)** When zero events are returned, automatically refetch with a wider radius (e.g. 250 km) and show a *"Showing wider area — nothing nearby"* note.
  - **(B)** Add a manual "expand search" button.
  - **(C)** Today's behavior.

### E-6. RPC timeout / network drop mid-load
- **Trigger:** User on a flaky train Wi-Fi. RPC hangs or fails.
- **Today:** `fetch` has no timeout, so it can hang forever. UI shows *"Loading events now."* indefinitely.
- **Options:**
  - **(A)** Wrap each RPC in `AbortController` with ~15s timeout; show a retry button on failure.
  - **(B)** Today's behavior + `Refresh` button works (already wired).

### E-7. User changes location (e.g. travels mid-session) and clicks Refresh
- **Trigger:** Tab is open at home (51.5N), user travels to Edinburgh, opens the tab, clicks Refresh.
- **Today:** `refreshEvents(eventState.center)` reuses the *cached* center, so they still see London events. Only "Use current location" updates the center.
- **Options:**
  - **(A)** Make `Refresh` re-run `getCurrentPosition` if `locationMode === "browser"`.
  - **(B)** Add a small "Re-detect location" affordance distinct from Refresh.

### E-8. URL deep-link with malformed event ID (e.g. SQL injection attempt)
- **Trigger:** `/events.html?event=<script>alert(1)</script>`.
- **Today:** [scripts/main.js:43](scripts/main.js#L43) reads it raw, [scripts/main.js:113](scripts/main.js#L113) writes it back to the URL via `searchParams.set` (encoded). Inside `[data-event-id="${escapeHtml(event.id)}"]`, IDs are escaped on render. The `requestedEventId` is only used to compare against RPC-returned IDs. Looks safe.
- **Verdict:** ✅ no XSS, but the unfiltered ID *would* be sent to Supabase. Server-side validation should already reject it; worth confirming.

### E-9. User has location enabled in OS but blocked for browser
- **Trigger:** macOS allows location for Safari but the site origin is denied.
- **Today:** Same path as E-1. Indistinguishable from "user denied".
- **Decision:** Folded into E-1.

### E-10. Same event RSVP list opened, then user navigates away before fetch completes
- **Trigger:** Slow network. User clicks "View details", regrets it, taps a different card.
- **Today:** [scripts/main.js:1053-1080](scripts/main.js#L1053-L1080) caches the in-flight fetch by adding to `registrationsLoading`, then `delete`s it on completion. If the user toggles the same event off+on while loading, second call exits early. Looks correct. Different events fire in parallel, no leak.
- **Verdict:** ✅ OK.

---

## CONTACT FORM

### E-11. User pastes a query >5,000 chars but ≤500 words
- **Trigger:** Long URLs / code blocks.
- **Today:** [contact.html:91](contact.html#L91) `maxlength="5000"` enforces char limit silently (browsers truncate paste). [website-feedback/index.ts:97](supabase/functions/website-feedback/index.ts#L97) also truncates server-side via `.slice(0, 5000)`. User isn't warned about truncation.
- **Options:**
  - **(A)** Show a char counter alongside the word counter when approaching 5000.
  - **(B)** Today's silent truncation.

### E-12. User submits, network error, retries — duplicate row written
- **Trigger:** First submit fails after the row was inserted but response was lost. User retries.
- **Today:** Two rows in `website_feedback`. No idempotency key.
- **Options:**
  - **(A)** Generate a client-side `submissionId` (UUID), persist with the row, unique constraint at DB. Function returns "already received" on duplicate.
  - **(B)** Today's behavior — admin sees both, dedupes manually.

### E-13. Email send fails for user OR admin (Resend down, quota hit)
- **Trigger:** Resend API outage.
- **Today:** [website-feedback/index.ts:69-83](supabase/functions/website-feedback/index.ts#L69-L83) returns `false` and logs nothing. The form shows *"…has been sent. We'll reply as soon as we can."* — but the admin never received the message.
- **Options:**
  - **(A)** If `adminEmailSent === false`, also write to a `failed_email_notifications` table or trigger an alternative alert (Slack webhook etc.).
  - **(B)** Show user a different success message when admin email failed: *"…we'll be in touch — sometimes it takes a moment for our queue to pick it up."*
  - **(C)** Today's silent fail.

### E-14. Honeypot blank submission still inserts a row
- **File:** [website-feedback/index.ts:91-93](supabase/functions/website-feedback/index.ts#L91-L93)
- **Today:** When `_hp` is filled, returns `{ ok: true, ignored: true }` *without* writing a row — good. But the field check happens *after* `await req.json()`, so a flood of bot submissions still consumes function invocations. Acceptable trade-off.
- **Verdict:** ✅ working as intended.

### E-15. Form submit while offline
- **Trigger:** No network.
- **Today:** Browser fetch rejects, error caught, status shows *"Unable to send your message right now."* Form is re-enabled. User retries when online. Reasonable.
- **Verdict:** ✅ OK.

### E-16. User declines analytics, then ticks the box on the form
- **File:** [scripts/contact.js:80-86](scripts/contact.js#L80-L86)
- **Today:** Per-form opt-in overrides global decline (`setAnalyticsConsent("accepted")` on submit). User may not understand they just changed a global setting. Privacy concern.
- **Options:**
  - **(A)** Make the form checkbox apply only to *this* submission, leaving the global decline intact.
  - **(B)** Add explicit copy: *"Ticking this also turns on analytics for the rest of the site."*
  - **(C)** Today's behavior.

---

## ADMIN — SOCIAL APPROVAL

### E-17. Admin opens the dashboard from two devices simultaneously
- **Trigger:** Phone + laptop both signed in.
- **Today:** Each device has its own `decisions` in `localStorage`. They don't sync. Admin approves item 1 on phone, opens laptop and sees pending. Then publishes from laptop *without* the phone's approval propagating.
- **Options:**
  - **(A)** Persist decisions server-side (Supabase row per `(queueId, draftIndex)`); read on dashboard load.
  - **(B)** Add a banner *"Decisions are saved on this browser only"* (already partly there). Acceptable for solo admin.

### E-18. Queue file changes between load and publish
- **Trigger:** A new queue is generated/uploaded; admin had a stale queue open and clicks Publish.
- **Today:** Publish goes through with the *old* `queueFile`/`queueGeneratedAt`. Server doesn't validate. Old draft indexes mismatch the new queue.
- **Options:**
  - **(A)** Server checks `queueGeneratedAt` against current latest; reject if stale.
  - **(B)** Embed a queue checksum on dashboard load and re-validate on Publish.
  - **(C)** Trust the admin (today's behavior).

### E-19. Admin approves a draft, then refreshes the page mid-session
- **Today:** Decisions stored in `localStorage` keyed on queue file ⇒ persist across reload. ✅ OK.

### E-20. Admin clicks Publish twice
- **Today:** Button is `disabled = true` after click ([admin-social.js:575](scripts/admin-social.js#L575)). ✅ OK.
- **But** the server doesn't reject duplicate publishes for the same draft. If button disable fails (CSS bug, dev tools, two tabs), same draft posts twice.
- **Options:**
  - **(A)** Track a `published_at` per draft on the queue row; server skips already-published.
  - **(B)** Trust client (today).

### E-21. Admin pastes a non-HTTPS media URL
- **File:** [supabase/functions/social-publish-approved/index.ts:107-112](supabase/functions/social-publish-approved/index.ts#L107-L112)
- **Today:** Server throws *"Media URL must be public HTTPS."* — caught and returned as `failed`. ✅ OK.

### E-22. Admin pastes a media URL that 404s
- **Today:** Server passes the URL straight to Instagram/TikTok, who attempt to PULL it and fail. Result returned as `failed` with the platform's error message.
- **Verdict:** ✅ acceptable; could pre-flight HEAD the URL.

### E-23. TikTok privacy_level set to PUBLIC_TO_EVERYONE on first publish
- **Note:** TikTok requires "audited" apps for `PUBLIC_TO_EVERYONE`; unaudited apps must use `SELF_ONLY`. Setting public on an unaudited app **silently fails or returns an error**.
- **Options:**
  - **(A)** Add an inline warning under the Privacy level dropdown: *"`PUBLIC_TO_EVERYONE` requires an audited TikTok app."*
  - **(B)** Today's behavior.

### E-24. Empty caption + empty hashtags from `fallbackCopy`
- **Trigger:** Draft with `copyMode = "general"` but `fallbackCopy.caption` empty.
- **Today:** `captionFor` returns empty string. IG accepts; TikTok requires text in `title`. Slice happens after empty input → fine.
- **Verdict:** ✅ degrades gracefully but UX could be better — surface in the admin card "Fallback caption is empty".

### E-25. Admin signs out from one tab, other tab still has dashboard
- **Today:** Other tab still has token in `sessionStorage` (per-tab) and continues to function until refresh. With `localStorage` it'd cross tabs. SessionStorage is per-tab so each tab is independent. ✅ acceptable.

### E-26. Magic-link expires before clicked
- **Today:** `getSupabaseUser` returns 401, dashboard stays in login state, error message shown. ✅ OK.

### E-27. Admin refreshes between approving drafts
- **Today:** Decisions in `localStorage` persist. Token in `sessionStorage` persists across refresh in same tab. ✅ OK.

### E-28. The `social_publish_settings` row is somehow deleted
- **Trigger:** Manual SQL by an operator.
- **Today:** Settings GET returns `null`, dashboard shows "Could not load publish settings." But on save, function uses `Prefer: resolution=merge-duplicates` — this *upserts* row id=1, so the next save recovers. ✅ OK.

### E-29. Token rotation on admin email
- **Today:** Sign-out clears `sessionStorage`. New magic link generates new token. Old tokens become invalid via Supabase TTL. ✅ OK.

---

## EVENT APPROVAL FLOW

### E-30. Email scanner pre-fetches the approval link
- **Trigger:** Some corporate email gateways follow links to scan for malware. Some do POSTs.
- **Today:** [approve-event.html:174](approve-event.html#L174) calls `action=preview` only on initial load — no mutation. ✅ Two-step click is required to mutate, exactly to defend against this.

### E-31. Admin opens approval link, walks away for 30 minutes, then clicks
- **Today:** No idle timeout. Clicking later still works because tokens are static. ✅ OK behaviorally but worth flagging — token doesn't expire.
- **Options:**
  - **(A)** Add `expires_at` to `event_approval_requests`; reject on stale.
  - **(B)** Today's behavior.

### E-32. Network drop mid-confirm
- **Today:** Button is disabled, "Working…" text shows. If network errors, no recovery — page is stuck.
- **Options:**
  - **(A)** Show an error and re-enable the button on failure.
  - **(B)** Today's behavior.

### E-33. Admin tries to reject an event that was already approved
- **Today:** [event-approval-confirm/index.ts:134-136](supabase/functions/event-approval-confirm/index.ts#L134-L136) — server returns the terminal `previewResponse`, message says *"This event has already been approved."* ✅ OK.

### E-34. Token in URL leaks via Referer when admin clicks an external link from the success page
- **Today:** Success page contains `<a href="https://triangulate.live">…` — this `Referer`s the previous page (the approval page with `?token=…`). Outbound link shares the token in `Referer` to the destination.
- **Options:**
  - **(A)** Add `<meta name="referrer" content="strict-origin">` or `referrerpolicy="no-referrer"` to the success-page links.
  - **(B)** Today's behavior — once a token is used, server marks status terminal so the leaked token is useless. ✅ Practically OK but tighten.

### E-35. Multiple admins click the same approval link from a shared inbox
- **Today:** First click wins; second sees terminal state. ✅ Works (modulo race condition B-7).

---

## LEADERBOARD

### E-36. Player with rank=0 or score=null
- **File:** [scripts/leaderboard.js:50-62](scripts/leaderboard.js#L50-L62)
- **Today:** `rank: row.rank ?? 999`, `score: row.score || 0`. `0 || 0 = 0` → fine. Display calls `score.toLocaleString()` → "0". ✅ OK.

### E-37. RPC returns >6 rows
- **Today:** `slice(0, 6)` truncates. ✅ OK.

### E-38. RPC returns 0 rows for `local`
- **Today:** Empty state shows *"No players yet."* — user could be confused about scope. Could show "Try city or global instead."
- **Options:**
  - **(A)** Add a soft suggestion when local is empty.
  - **(B)** Today's behavior.

### E-39. Player ID copied from app to web via deep-link expires/changes
- **File:** [scripts/site-core.js:25-32](scripts/site-core.js#L25-L32)
- **Today:** `localStorage` persists `triangulate_player_id` indefinitely. If a player wipes their app, the web page's stale ID still gets used in `get_my_bracket`. Backend should treat it as unknown viewer.
- **Verdict:** ✅ benign — bracket just won't show "is_me".

---

## SOCIAL POSTS RENDER ON HOMEPAGE

### E-40. `data/social-posts.json` 404s
- **Today:** [scripts/main.js:1196-1202](scripts/main.js#L1196-L1202) catches and returns `socialPosts` (the empty fallback array). User sees *"Fresh updates will appear here."* ✅ OK.

### E-41. `social-posts.json` posts have URLs to deleted Instagram/TikTok content
- **Today:** Click yields a 404 on the platform. No client-side validation.
- **Options:**
  - **(A)** Sync job verifies URLs and removes broken ones.
  - **(B)** Today's behavior.

---

## CROSS-CUTTING

### E-42. CSS file requested with cache-bust query param has stale version mismatch across pages
- **Files:** Various — `?v=202604202005`, `?v=202604231710`, `?v=202604202035`.
- **Today:** Different pages reference different cache-bust versions of the same `styles/site.css`. Some pages serve old CSS while others serve new. CSS is one file, so the latest URL wins in the browser cache, but on first visit the *requested* version is per-page.
- **Options:**
  - **(A)** Centralise: build step that rewrites `?v=` consistently before deploy.
  - **(B)** Just keep them in sync manually (today).

### E-43. Service worker / offline cache (none)
- **Today:** No service worker registered → no offline support, no install banner. Probably fine for a marketing site.
- **Verdict:** ✅ acceptable for current scope.

### E-44. iOS Safari + BFCache on the events page
- **Trigger:** User scrolls events, navigates back via swipe, comes back.
- **Today:** Module re-runs may not fire because BFCache restores the page. `pagehide` fires (which cancels the canvas animation) but reload doesn't reset state. May cause animation freeze + stale data.
- **Options:**
  - **(A)** Listen for `pageshow` event and re-init/refresh.
  - **(B)** Today's behavior.

### E-45. Time zones — events page formats with `en-GB`
- **File:** [scripts/main.js:580-592](scripts/main.js#L580-L592)
- **Today:** Format uses local time zone (correct), but locale is forced `en-GB` regardless of user. Spanish users see English month abbreviations. Minor.
- **Options:**
  - **(A)** Default locale to `navigator.language`.
  - **(B)** Today's behavior (London-first launch).

---

## Summary of decisions you need to make

| # | Decision |
|---|---|
| E-1 | Add Permissions API hint when geolocation is denied? (recommended) |
| E-3 | Pick fallback strategy for missing event fields. |
| E-4 | Pick (A) re-fetch shared event by ID, (B) banner, or (C) silent drop. |
| E-5 | Auto-expand radius vs manual button vs nothing. |
| E-6 | Add 15s RPC timeout? (recommended) |
| E-12 | Add idempotency key on contact submissions? |
| E-13 | Decide alerting path when admin email send fails. |
| E-16 | Make form analytics-consent local-only or keep global. |
| E-17 | Persist admin decisions server-side or accept solo-admin model. |
| E-18 | Validate queueGeneratedAt on Publish or trust admin. |
| E-31 | Add token expiry on approval requests? |
| E-34 | Tighten Referer policy on approve-event success page. |
| E-44 | Add `pageshow` re-init for BFCache. |

The other items are mechanical hardening you can simply do.
