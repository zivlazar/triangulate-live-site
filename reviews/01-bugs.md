# Report 1 — Code Review: Bugs

**Scope:** All HTML, JS modules, Supabase edge functions, and SQL migrations in `triangulate-live-site`.
**Date:** 2026-04-25

Each bug has a **severity** (Critical / High / Medium / Low), a **fix sketch**, and a **decision option**.

---

## CRITICAL

### B-1. `approve-event.html` points to the wrong Supabase project
**File:** [approve-event.html:107-109](approve-event.html#L107-L109)

```js
const GAME_SUPABASE_URL = 'https://rgczribfoutvpashjgrx.supabase.co'   // GAME project
const GAME_SUPABASE_ANON_KEY = '...'
const FUNCTION_URL = GAME_SUPABASE_URL + '/functions/v1/event-approval-confirm'
```

But the `event-approval-confirm` function is deployed in **this** repo (the LIVE-SITE project, [site-config.js:1](scripts/site-config.js#L1) → `wnkbkgnydrmwgudbdqin.supabase.co`). And the function itself returns the message *"This approval link was not found in the new live-site project"* — implying tokens live here.

So either:
- `event-approval-confirm/index.ts` in this repo is dead code, OR
- `approve-event.html` is hitting the wrong URL and approvals are actually being processed by the GAME project (where the same function name presumably exists with the real data).

Either way, the two halves don't agree.

**Decision:**
- **(A)** If the live-site IS the source of truth → change `GAME_SUPABASE_URL`/`KEY` in [approve-event.html](approve-event.html) to use [site-config.js](scripts/site-config.js)'s values.
- **(B)** If the GAME project IS the source of truth → delete `supabase/functions/event-approval-confirm/` and the `event_approval_requests` table from the live-site migration.

---

### B-2. SQL functions in the migration are empty stubs
**File:** [supabase/migrations/20260423150500_live_site_support.sql:65-83, 96-104, 124-140](supabase/migrations/20260423150500_live_site_support.sql#L65-L83)

`list_public_events_near`, `get_event_registrations`, and `get_my_bracket` all return `… where false` — i.e. zero rows.

That means today, on production, the events page and leaderboard page will render the empty state forever. Unless these functions are *also* defined elsewhere (separate non-checked-in migration, or another script overrides them), the website cannot show any events or scores.

**Decision:**
- **(A)** These are placeholders and the real bodies are applied out-of-band on the Supabase project — document that and keep stubs.
- **(B)** Restore real implementations into this migration so the schema is reproducible from git.

---

## HIGH

### B-3. `isRecentEvent` has no lower bound — ancient finished events count as "recent"
**File:** [scripts/main.js:600-603](scripts/main.js#L600-L603)

```js
function isRecentEvent(event) {
  const scheduled = parseScheduledFor(event.scheduled_for);
  return scheduled ? scheduled.getTime() < Date.now() : false;
}
```

Any past event — last week, last year — is "recent". Combined with `EVENT_LIMIT = 50` server-side, the recent section can fill with stale history.

**Fix sketch:**
```js
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
return scheduled
  ? scheduled.getTime() < Date.now() && Date.now() - scheduled.getTime() < RECENT_WINDOW_MS
  : false;
```

**Decision:** Pick a window — 24h, 48h, 7d. (Recommend 48h.)

---

### B-4. "Finished Xh ago" never rolls over to days
**File:** [scripts/main.js:613-616](scripts/main.js#L613-L616)

```js
if (minutesAgo < 60) return `Finished ${minutesAgo} min ago`;
return `Finished ${Math.floor(minutesAgo / 60)}h ago`;
```

Past 24h you'll see *"Finished 168h ago"*. (Largely moot if you also fix B-3.)

**Decision:** After fixing B-3 this becomes cosmetic. Recommended: cap at "2d ago" → fall back to formatted date.

---

### B-5. Concurrent event refreshes on first load
**File:** [scripts/main.js:1266-1270](scripts/main.js#L1266-L1270)

On the events page:
1. Line 1269: `refreshEvents()` fires with the London fallback center.
2. Line 1270: `autoLocateEvents()` fires geolocation → calls `refreshEvents()` again with the user's location.

Both run concurrently, both write to `eventState.events`. Whichever response returns last wins. Usually the geo result returns later (good), but on slow networks the order is undefined and the user can briefly see London events, then their location's events, or vice versa.

**Fix sketch:** Skip the initial fallback fetch if `navigator.geolocation` exists (since `autoLocateEvents` will fire), OR add a request-id guard so older responses are dropped.

**Decision:**
- **(A)** Defer initial fetch to `autoLocateEvents`, fall back to London fetch only if geolocation is unavailable / denied.
- **(B)** Keep concurrent and add a sequence guard so stale results are discarded.

---

### B-6. Instagram video publishing skips container-readiness polling
**File:** [supabase/functions/social-publish-approved/index.ts:161-180](supabase/functions/social-publish-approved/index.ts#L161-L180)

For Reels, the IG Graph API needs the container to reach `status_code=FINISHED` before `/media_publish`. The function POSTs media_publish immediately. For images this works; for videos it commonly fails with "Media not ready".

**Fix sketch:** Poll `${graphBase}/${creationId}?fields=status_code` (max ~30s, every 2s) until `FINISHED` before publishing.

**Decision:**
- **(A)** Add polling now (recommended — it's the documented IG flow).
- **(B)** Document this caveat and only ship single-image posts via the API; do Reels manually.

---

### B-7. Approve/reject double-submit race
**File:** [supabase/functions/event-approval-confirm/index.ts:127-138](supabase/functions/event-approval-confirm/index.ts#L127-L138)

```ts
const row = await fetchRequest(token);
…
if (row.status !== "pending") return json(previewResponse(row));
await updateRequest(row.id, action);
```

Two parallel POSTs (e.g. an admin double-clicks, an email scanner pre-fetches) can both pass the `status === "pending"` check and both PATCH the row. Last write wins. Idempotent for same action; for `approve` vs `reject` collisions, last one wins silently.

**Fix sketch:** Use PATCH with `status=eq.pending` filter so PostgREST applies the guard atomically:
```ts
fetch(`${supabaseUrl}/rest/v1/event_approval_requests?id=eq.${id}&status=eq.pending`, …)
```
Then check `row_count` from the response — if 0, the request had already been handled.

---

## MEDIUM

### B-8. `dryRun` is resolved three times with three slightly different fallbacks
**File:** [supabase/functions/social-publish-approved/index.ts:121-124, 192-195, 305-308](supabase/functions/social-publish-approved/index.ts#L121-L124)

Three blocks reimplement the same default-resolution. Two use `env("SOCIAL_PUBLISH_DRY_RUN", "true") !== "false"`, one uses `envBoolean("SOCIAL_PUBLISH_DRY_RUN") ?? true`. They behave the same today but will drift.

**Fix sketch:** Extract `resolveDryRun(stored)` and reuse.

---

### B-9. PostgREST error-message reads use `.message` on arrays
**File:** [supabase/functions/event-approval-confirm/index.ts:54, 83](supabase/functions/event-approval-confirm/index.ts#L54)

```ts
const rows = await res.json().catch(() => []);
if (!res.ok) throw new Error(rows.message || "…");
```

PostgREST returns either an array of rows or an error object on failure. `rows.message` only exists on the error-object branch. With the `.catch(() => [])`, it's an array, and `.message` is `undefined` — you always get the fallback. Dead code.

**Fix sketch:** Don't pre-default `rows` to `[]`; check `res.ok` first, then parse.

---

### B-10. `loadSocialPosts` accepts the wrong shape silently
**File:** [scripts/main.js:1194-1203](scripts/main.js#L1194-L1203)

```js
const payload = await res.json();
return Array.isArray(payload.posts) ? payload.posts : socialPosts;
```

If the JSON is a top-level array (which `data/social-posts.json` may or may not be), `payload.posts` is `undefined` and the fallback (empty array) silently replaces real data.

**Fix sketch:** Accept both shapes:
```js
return Array.isArray(payload) ? payload : Array.isArray(payload?.posts) ? payload.posts : socialPosts;
```

---

### B-11. Auto-geolocation prompts on first events-page load without user consent
**File:** [scripts/main.js:1046-1051](scripts/main.js#L1046-L1051)

`autoLocateEvents()` immediately calls `navigator.geolocation.getCurrentPosition`, which triggers the browser's permission prompt the moment the user lands on `events.html`. Some users will hard-deny → location is then unavailable for that session.

**Fix sketch:** Render a soft "Use current location" CTA first; only call geolocation on click. (The button already exists.)

**Decision:**
- **(A)** Keep the auto-prompt (current). Optimal for users who'd grant permission anyway.
- **(B)** Switch to manual (less surprising, fewer hard-denies, lower distance accuracy out of the box).

---

### B-12. Geolocation timeout is short for cold GPS
**File:** [scripts/main.js:1009-1014](scripts/main.js#L1009-L1014)

`timeout: 10000`, `enableHighAccuracy: false`. On mobile cold-start (no recent GPS fix, no Wi-Fi position), 10s often isn't enough → user sees "Couldn't get your location."

**Fix sketch:** Bump to 20–30s or do a quick low-accuracy attempt then upgrade.

---

### B-13. `event-approval-confirm` token is silently truncated to 240 chars
**File:** [supabase/functions/event-approval-confirm/index.ts:33-35](supabase/functions/event-approval-confirm/index.ts#L33-L35)

If a real token is longer than 240 chars (e.g. JWT-style), the slice produces a non-matching value and the user gets "approval link not found" with no clue why.

**Fix sketch:** Reject overlong tokens with a clear error instead of silently truncating, and right-size the limit to whatever the token format actually is.

---

### B-14. `setInterval(refresh, 30000)` on the leaderboard never clears
**File:** [scripts/leaderboard.js:237](scripts/leaderboard.js#L237)

If a user keeps the page open for hours, every 30s a new RPC fires. Long tabs = hundreds of unnecessary requests. Also: no visibility check (refreshes when tab is hidden too).

**Fix sketch:** Pause when `document.hidden`, resume on `visibilitychange`. Clear on `pagehide`.

---

### B-15. Magic-link token written to sessionStorage before email is verified
**File:** [scripts/admin-social.js:103-117](scripts/admin-social.js#L103-L117)

```js
const token = params.get("access_token") || "";
if (token) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);   // stored first
  …
}
```

Then `restoreSession()` calls Supabase to verify, and *if* the email isn't the admin email, removes the token. Tiny window where any same-origin script (XSS / a misbehaving extension) can read it.

**Fix sketch:** Verify before persisting. Only `setItem` after `getSupabaseUser` returns the admin email.

---

## LOW

### B-16. Empty caption sent to Instagram
**File:** [supabase/functions/social-publish-approved/index.ts:150-153](supabase/functions/social-publish-approved/index.ts#L150-L153) — `caption=` is sent even when no text. IG generally accepts but it's noise; only set the field when non-empty.

### B-17. `els.loginForm.querySelector("button")` is positional
**File:** [scripts/admin-social.js:618-619, 626](scripts/admin-social.js#L618-L619) — fragile if a second button is added. Use a specific selector (e.g. `[type=submit]` is fine, or an id).

### B-18. `console.error` leaks RPC errors to user devtools
**File:** [scripts/leaderboard.js:226](scripts/leaderboard.js#L226) — minor info disclosure. Not a security issue but tidy up by stripping stack/message.

### B-19. `INITIAL_EVENT_ID` is captured at module-evaluation time
**File:** [scripts/main.js:43](scripts/main.js#L43) — fine for plain page loads; would break if the codebase ever moves to client-side routing.

### B-20. `renderTabs` rebinds click listeners on every call
**File:** [scripts/leaderboard.js:101-105](scripts/leaderboard.js#L101-L105) — currently called once per init so harmless. Brittle if reused.

### B-21. Two visual treatments for "upcoming" vs "recent"
**File:** [scripts/main.js:937-953](scripts/main.js#L937-L953) — upcoming uses an inline section, recent uses `eventSectionMarkup`. Cosmetic divergence.

### B-22. Hardcoded London fallback center (`51.5074, -0.1278`)
**File:** [scripts/main.js:34-38](scripts/main.js#L34-L38) — non-London users without geolocation see London events. Acceptable for a London-first launch; flag for international rollout.

### B-23. Unbound timeline on `pagehide` cleanup
**File:** [scripts/main.js:563-570](scripts/main.js#L563-L570) — the canvas animation correctly cancels on `pagehide`, but `pagehide` doesn't always fire on iOS BFCache. Use `visibilitychange` as a complement.

---

## Summary of decisions you need to make

| # | Decision |
|---|---|
| B-1 | Pick (A) live-site or (B) game project as the approval source-of-truth. |
| B-2 | Decide whether SQL stubs are intentional placeholders or need real bodies in the migration. |
| B-3 | Pick a "recent" window: 24h / 48h / 7d. |
| B-5 | Pick (A) sequential geolocate-first or (B) concurrent with sequence guard. |
| B-6 | Pick (A) add IG container polling or (B) ship images-only via the API. |
| B-11 | Pick (A) auto-prompt geolocation or (B) wait for explicit click. |

The rest are mechanical fixes that don't need a strategy decision.
