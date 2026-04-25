# Report 5 — Self-Check / Verification of Reports 01-04

**Scope:** Independently re-read the code; verify, challenge, and supplement the previous review.
**Date:** 2026-04-25

---

## 1. Wrong / overstated findings

### B-9 (overstated → minor)
**File:** [supabase/functions/event-approval-confirm/index.ts:53-54](supabase/functions/event-approval-confirm/index.ts#L53-L54)
The claim is "always get the fallback because rows is `[]`." Wrong. PostgREST returns its error body as a JSON object on non-2xx responses, and `await res.json()` parses it successfully — the `.catch(() => [])` only fires on a parse failure, not an HTTP failure. So when `!res.ok` and the error body is `{ "message": "…" }`, `rows.message` IS defined. The bug is real only in the rare case PostgREST returns non-JSON. Re-rate as **trivial** rather than medium.

### B-10 (overstated for current data)
**File:** [scripts/main.js:1217-1226](scripts/main.js#L1217-L1226)
`data/social-posts.json` already uses the `{posts: []}` shape (verified). The fallback `socialPosts` from `content.js:418` is also `[]`. Today, both return empty. The "silently replaces real data" scenario can't happen with the current file. Still worth fixing defensively, but not "Medium" today — **Low**.

### B-19 (overstated)
**File:** [scripts/main.js:43](scripts/main.js#L43)
"Captured at module-evaluation time" is exactly correct for a static SPA-less site. Listing it as a bug is theoretical-only. Drop or downgrade to a "future" note.

### B-20 (incorrect as written)
**File:** [scripts/leaderboard.js:101-105](scripts/leaderboard.js#L101-L105)
`renderTabs` is called twice on init (scope tabs and time tabs) and never again — confirmed by reading `initLeaderboard`. The "rebinds on every call" warning is mis-cued because `renderTabs` is only called once per container. There is, however, a related real issue: `renderTabs` adds an `addEventListener` to `container` even though it also rewrites `container.innerHTML`. innerHTML replacement does not detach container-level listeners, so the listener survives — fine here. Drop B-20.

### B-23 (overstated)
**File:** [scripts/main.js:563-570](scripts/main.js#L563-L570)
The `pagehide` handler does fire when iOS BFCache stores the page (it's the documented Webkit behaviour — the spec for `pagehide` covers BFCache eviction). The concern is real for `pageshow` re-entry to a frozen state, but that's already raised under E-44. Treat B-23 as duplicate of E-44.

### Line numbers
**Several findings** cite line ranges that differ from the actual file by ~30 lines (e.g. B-5 cites 1266-1270 but the init block is at 1291-1296; B-15 cites 103-117 but the relevant code is at 103-117 — this one is right). A reader chasing the cited lines will sometimes land in the wrong region. Worth re-running line refs against current `main.js`.

---

## 2. Missed findings

### M-1. Unescaped player data in leaderboard render → stored XSS risk
**Severity: HIGH (security)**
**File:** [scripts/leaderboard.js:117-141, 159-162, 173-186](scripts/leaderboard.js#L117-L141)
Multiple template literals inject server-supplied strings directly into `innerHTML` with no escaping:
- Line 131 — `${player.is_me ? "You" : player.name}`
- Line 132 — `${locationValue(scope, player)}` and `${player.last_event_date || "Recent"}`
- Line 160 — `${mover.is_me ? "You" : mover.name}`
- Lines 173-186 — `${topLocation}`, `${recentEvent}`, `${topPlayer.name}`

`player.name` comes from `row.nickname` and `row.last_event` etc. via the public anon RPC `get_my_bracket`. Any field containing `<script>…</script>` or an `onerror=` handler renders as HTML. Server side, nicknames are user-editable in the player app and travel through this RPC unfiltered. **This is the only real exploitable XSS hole I found.** The events code path uses `escapeHtml` correctly; leaderboard does not.

**Fix:** Reuse the `escapeHtml` from `main.js` (or import it) and wrap every interpolation.

### M-2. OAuth callback pages leak `code` (and `state`) via Referer
**Severity: MEDIUM (security)**
**Files:** [auth/instagram/callback/index.html:34-69](auth/instagram/callback/index.html#L34-L69), [auth/tiktok/callback/index.html:34-69](auth/tiktok/callback/index.html#L34-L69)
The pages place the OAuth `?code=…&state=…` in URL, render a "Back to Triangulate" link to `../../../index.html`, and have no `referrer` policy. Clicking the link sends `Referer: https://triangulate.live/auth/instagram/callback/?code=AQ…&state=…` to the destination origin. Although these codes are short-lived and meant to be exchanged immediately, leaking them violates OAuth handling guidance.
**Fix:** Add `<meta name="referrer" content="no-referrer">` to both callback pages and/or strip the query string after read with `history.replaceState`.

### M-3. `email_sent` / `admin_email_sent` columns are dead in DB
**Severity: LOW (data integrity)**
**File:** [supabase/functions/website-feedback/index.ts:38-67](supabase/functions/website-feedback/index.ts#L38-L67), [supabase/migrations/20260423150500_live_site_support.sql:14-15](supabase/migrations/20260423150500_live_site_support.sql#L14-L15)
The schema has `email_sent` and `admin_email_sent` boolean columns. The function never updates them — the row is inserted with the defaults (`false`) and the actual Resend send results are returned to the client only. Anyone querying `website_feedback` for delivery state (e.g. retry tooling) sees stale `false` for every row.
**Fix:** Either drop the columns or add a follow-up `PATCH` after the Resend calls.

### M-4. `social-channel-grid` render path is dead
**Severity: LOW (code cleanup)**
**File:** [scripts/main.js:1228-1247](scripts/main.js#L1228-L1247)
`renderSocialFrontPage` reads `document.getElementById("social-channel-grid")` and conditionally renders a grid of social channel cards. No HTML file in the repo contains `id="social-channel-grid"` (verified across `*.html`). About 20 lines of dead code. Same pattern: G-3 covered "dead mock data" but missed this dead code in the live module.

### M-5. `comment` vs `code` mismatch in `event-approval-confirm`
**Severity: LOW (operational confusion)**
**File:** [supabase/functions/event-approval-confirm/index.ts:128](supabase/functions/event-approval-confirm/index.ts#L128)
The error string `"This approval link was not found in the new live-site project."` claims tokens live in the live-site project. But `approve-event.html:107` deliberately points to the GAME project for this same function. So either the message is wrong, or `approve-event.html` is wrong, or both functions exist. The comment reveals the architectural confusion B-1/G-1 raised, but the inconsistent error message itself is its own footgun: an admin who hits "approval link not found" will look in the wrong project.

### M-6. `autoLocateEvents` is silently skipped when a deep-link event ID is present
**Severity: MEDIUM (UX)**
**File:** [scripts/main.js:1046-1051](scripts/main.js#L1046-L1051)
`if (eventState.requestedEventId) return;` — meaning a user who follows a shared event link never gets their location detected. They'll see "Distances stay hidden until your location is available" forever, even after they grant permission another way. The previous review caught E-4 (event not in radius) but missed that the user landing on a deep link gets *no* geolocation attempt at all.
**Fix:** Even with a `requestedEventId`, attempt geolocation in the background — distance pills don't change which event is expanded.

### M-7. `els.draftGrid` "input" listener writes localStorage on every keystroke
**Severity: LOW (perf/wear)**
**File:** [scripts/admin-social.js:674-685](scripts/admin-social.js#L674-L685)
For long reviewer notes / media URLs, every keystroke `JSON.stringify`s the entire decisions object and writes it. With 50 drafts and a 200-char note, that's ~10 KB writes per keystroke. Add a small `requestIdleCallback`/debounce.

### M-8. `Number(decisionButton.dataset.index)` accepts non-numeric → phantom decisions
**Severity: LOW (defensive)**
**File:** [scripts/admin-social.js:660, 669, 677](scripts/admin-social.js#L660)
If the dataset attribute is missing or non-numeric, `Number(undefined) === NaN` → `draftId(NaN) === "draft-NaN"` → an entry is silently created in `state.decisions["draft-NaN"]` and persisted. Won't crash, but pollutes export.

### M-9. `phone_number` and `company_name` are accepted but never used downstream
**Severity: LOW (privacy minimisation)**
**File:** [supabase/functions/website-feedback/index.ts:41-42](supabase/functions/website-feedback/index.ts#L41-L42), admin email body line 122 only includes `name` and email, not phone/company.
The contact form collects `phoneNumber` and `companyName` and stores them. The admin email never includes them, so the only way to retrieve them is querying the DB. Either remove them from the form or include them in the admin email — collecting extra PII without using it is a GDPR data-minimisation issue (R-9 touches PII retention but didn't notice the unused fields).

### M-10. `responseConsent` validation: client/server agree but the contact form has `novalidate`
**Severity: LOW**
**File:** [contact.html:64](contact.html#L64), [scripts/contact.js:62-101](scripts/contact.js#L62-L101)
Form has `novalidate`; client JS doesn't re-check `responseConsent` before submit. If the user un-ticks the consent box (it's pre-unchecked), the request still goes to the server, which throws "Consent is required" → user sees an error after clicking. Better UX: validate before submit.

### M-11. `tiktok_brand_organic_toggle` save uses `!== false` semantics, others use `Boolean(...)`
**Severity: LOW (consistency bug)**
**File:** [supabase/functions/social-publish-settings/index.ts:203](supabase/functions/social-publish-settings/index.ts#L203)
`tiktok_brand_organic_toggle: incoming.tiktokBrandOrganicToggle !== false` — defaults to true if undefined; every other toggle is `Boolean(...)` (defaults to false). If the client posts a partial body without this field, brand organic toggle is forced true. Inconsistent and surprising.

### M-12. CORS preflight allow-list missing `accept`/`prefer`
**Severity: LOW**
**Files:** All four edge functions, e.g. [website-feedback/index.ts:3](supabase/functions/website-feedback/index.ts#L3)
`Access-Control-Allow-Headers` enumerates `authorization, x-client-info, apikey, content-type` only. Some browsers/SDKs send `accept` or other headers; preflight will fail. Today's clients don't send extra headers, but if you ever route through a Supabase JS client config change, requests may break silently.

### M-13. `loadStoredSettings` swallows non-OK responses → silent fallback to env
**Severity: MEDIUM (operational)**
**File:** [supabase/functions/social-publish-approved/index.ts:85-96](supabase/functions/social-publish-approved/index.ts#L85-L96)
If the GET to `social_publish_settings` fails (network blip, RLS misconfig, etc.), the function returns `null` and silently falls back to `env(...)` defaults. An admin who saved live tokens in the portal would publish with the env defaults instead — no error, no log. A tiny outage could publish dry-run posts as live (or vice versa) without anyone noticing.
**Fix:** Throw on the GET failure, or surface a "settings fetch failed" warning in the publish result.

### M-14. `social_publish_settings` table defaults `tiktok_brand_organic_toggle` to `true`
**Severity: LOW**
**File:** [supabase/migrations/20260423174000_social_publish_settings.sql:13](supabase/migrations/20260423174000_social_publish_settings.sql#L13)
Schema default = true. Combined with M-11, this means the toggle is "on" out of the gate even when no admin has touched it. Probably intended; flag for explicit decision in the privacy/branding policy.

### M-15. Admin login: no `autocomplete=off` on the email input
**File:** [admin-social.html:73](admin-social.html#L73)
Pre-filling the admin email (R-6) plus `autocomplete="email"` increases the chance of password managers cataloguing it. Combined with R-6, suggest removing the prefill AND the autocomplete hint.

### M-16. `await res.json().catch(() => [])` then `Array.isArray(rows) ? rows[0] || null : null` (load) but `?id=eq.1&select=*` returns an array
**File:** [supabase/functions/social-publish-settings/index.ts:92-93](supabase/functions/social-publish-settings/index.ts#L92-L93)
Code is technically correct, but if Postgres returns null `rows` (parse failed) the function returns `null`. The caller then renders `Could not load publish settings.` (admin-social.js:406). Fine, just brittle.

### M-17. Honeypot submission still spends a Resend send/email check
Wait — re-checked: line 91 returns early before insertFeedback / sendEmail. Honeypot path is cheap. **Not a bug; the prior E-14 verdict (✅) is correct.**

---

## 3. Severity disagreement

| ID | Original | My re-rate | Reason |
|---|---|---|---|
| **B-1** | Critical | **Critical (correct)** | Two-project mismatch causing real or potential dead-code in production. Stand. |
| **B-2** | Critical | **High** | Stubs are obviously stubs and the failure mode (empty page) is benign — nobody ships an empty events page silently to prod without noticing. Critical implies imminent production damage; this is "site is empty until you do the real thing". |
| **B-3** | High | **Medium** | "All past events count as recent" is bad UX, but no security impact and the page caps at 50 results. |
| **B-6** | High | **High (correct)** | Reels publish-without-poll fails ~50% of the time on real video uploads; users will think the function is broken. |
| **B-7** | High | **High (correct)** | Race lets a reject silently overwrite an approve. |
| **B-9** | Medium | **Trivial** | (See section 1.) |
| **B-13** | Medium | **Low** | Token format is currently "240 char limit" by design; the codebase chose this slice intentionally — it's only a bug if the token format changes. Re-rate Low. |
| **B-15 / R-2** | Medium | **Medium (correct)** | XSS-window issue is the real reason; on its own writing to sessionStorage is OK. |
| **R-3** | Low | **Medium** | When the real `get_my_bracket` body ships, anyone with a stranger's `player_id` can read their bracket. That's a real privacy leak. |
| **R-6** | Low | **Low (correct)** | Public knowledge of the admin email is normal for solo-admin tools; spear-phishing is theoretical here. |
| **R-7** | Medium | **Medium (correct)** | Tokens at rest with service-role-key access is the documented Supabase model; encryption is upgrade, not fix. |
| **M-1 (new)** | — | **High** | Stored-XSS path through nickname into the leaderboard. Patch first. |
| **M-13 (new)** | — | **Medium** | Silent settings-fetch fallback can flip dry-run live without warning. |

---

## 4. Duplicate / redundant findings

| Pair | Comment |
|---|---|
| B-1 ↔ R-12 ↔ G-1 | Same fundamental issue (two-Supabase-project split) listed three times. Combine. |
| B-14 ↔ R-16 ↔ R-17 | Three IDs for "leaderboard interval polls forever, no visibility check, no cleanup." All facets of the same problem. |
| B-15 ↔ R-2 | Verbatim cross-reference. R-2 explicitly says "Already in B-15." Keep one. |
| B-23 ↔ E-44 | Both about iOS BFCache + canvas / pagehide. E-44 covers it more accurately. |
| E-9 → folded into E-1 | Original review already noted this. ✅ |
| R-11 ↔ E-34 | Same Referer-leak issue. Pick one. |
| R-18 ↔ E-42 | Same cache-bust drift. Pick one. |
| G-15 ↔ E-16 | Same per-form analytics-consent issue. Pick one. |
| G-23 ↔ G-4 ↔ E-17 | Three IDs for "decisions in localStorage = single-admin only". Pick one canonical and let the others be footnotes. |

---

## Confidence

### Trust as-is
- **B-1 / R-12 / G-1** — two-project mismatch. Verified, real, important.
- **B-3 / B-4** — `isRecentEvent` & "Finished Xh" — verified, simple to fix.
- **B-5** — concurrent fetch race on first events load — verified.
- **B-6** — IG container-readiness polling — well-documented IG API behaviour.
- **B-7** — approve/reject PATCH race — verified, conditional update is the standard fix.
- **B-11 / E-1** — auto-prompt geolocation behaviour — verified, decision call belongs to Ziv.
- **B-14 / R-16 / R-17** — setInterval housekeeping — verified, mechanical fix.
- **B-15 / R-2** — token written before verification — verified, narrow XSS window.
- **R-9** — PII retention story — verified, GDPR concerns real.
- **E-12** — no idempotency on contact form — verified.
- **E-17 / G-4** — multi-device decisions disagree — verified.

### Want a third pair of eyes
- **B-2 (SQL stubs)** — I cannot tell whether real bodies exist out-of-band on the live Supabase project. If they do, the rating is "documentation gap"; if they don't, the production website is broken. Worth confirming via `supabase db dump` or an MCP read against the project before deciding.
- **R-3 (RPC body audit)** — same: depends on what the live RPC bodies actually do once they ship.
- **R-21 (TikTok/IG audit)** — I have no live API behaviour to test against.
- **M-13 (silent settings fallback)** — needs reproduction in a real publish run.
- **G-7 / G-8 (filter UI / pagination)** — product decisions, not code review.

### Things the original review under-emphasised
- **M-1 (leaderboard XSS)** is the highest-priority security item I found and it wasn't called out anywhere in the four reports.
- **M-6 (deep-link bypasses geolocation)** is a real UX bug for the most common share-flow scenario.
- **M-13 (silent settings fallback)** can flip dry-run live without warning.

---

## Top 5 to fix first

1. **M-1 — Escape player nicknames + locations in leaderboard** (`scripts/leaderboard.js:117-186`). Stored XSS via the public RPC `get_my_bracket`. ~10 minutes.
2. **B-1 — Resolve the two-Supabase-project split** for `approve-event.html` (and remove the misleading "not found in the new live-site project" message in `event-approval-confirm/index.ts:128`). Whichever side is the source of truth, the other half should be deleted. Today the two halves don't agree.
3. **B-7 — Atomic approve/reject** by adding `&status=eq.pending` to the PATCH in `event-approval-confirm/index.ts:72`. ~5 minutes.
4. **B-14 / R-16 — Pause leaderboard polling when `document.hidden`** and clear on `pagehide`. Stops leaderboard from hammering Supabase from forgotten tabs. ~10 minutes.
5. **B-3 — Bound `isRecentEvent` with a 48-hour window** (`scripts/main.js:600-603`). Trivial, but makes the events page sane immediately even before any real events flow.

(Honourable mentions for items 6-7 if there's appetite: **B-15** verify-before-persist, and **M-2** referrer policy on OAuth callbacks.)
