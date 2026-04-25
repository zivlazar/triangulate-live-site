# Report 4 — Logical Gaps & Better Solutions

**Scope:** Things the code doesn't do but probably should; alternative approaches that beat what's in place.
**Date:** 2026-04-25

This report flags **what's missing** and proposes **a cleaner path**, with a decision option for each.

---

## ARCHITECTURAL GAPS

### G-1. Two Supabase projects with no clearly-named seam
**Files:** [scripts/site-config.js:1](scripts/site-config.js#L1) (live-site, `wnkbkgnydrmwgudbdqin`); [approve-event.html:107](approve-event.html#L107) (game, `rgczribfoutvpashjgrx`)

There's a *physical* split (two databases) but no *conceptual* split documented anywhere. Some flows cross the boundary, some don't. Anyone new (including you in three months) will guess wrong.

**Better solution:**
- Pick one project as the **public-facing live site**: events listing, leaderboard, contact form, social publishing, event approvals.
- Pick the other (game project) as the **player-facing app backend**: registrations, scoring, identity.
- Write [`docs/architecture.md`](docs/) with one diagram showing which tables/functions live where and why.
- Where the live-site reads "owned" data (events, leaderboard), use a *thin* edge function in the live-site project that calls the game project — never call the game project's anon URL directly from the browser. That gives you one stable contract for the website regardless of how the backend evolves.

**Decision:**
- **(A)** Adopt the boundary above; refactor `approve-event.html` to hit the live-site project.
- **(B)** Adopt a different boundary you prefer; document it.
- **(C)** Keep status quo; add a `docs/architecture.md` documenting the existing split (faster, lower risk, tech debt remains).

---

### G-2. Frontend state is global module-level, not encapsulated
**File:** [scripts/main.js:45-59](scripts/main.js#L45-L59)

`eventState` is a module-level object touched by ~10 functions. Adding a feature means scanning the whole file to know what reads/writes which field. The `bindEventsPage / refreshEvents / renderEvents` triad re-renders by re-reading state directly.

**Better solution:**
- Wrap state in a small store object: `{ getState, setState, subscribe }`. Render is a single `subscribe(render)` call; mutations set state and trigger re-render.
- Or — since the project deliberately avoids frameworks — extract a `createEventsModel()` factory that returns the only sanctioned mutators, and export `events.html`-specific render.

**Decision:**
- **(A)** Refactor to a small store (one file change, ~40 lines added; clearer for next 10 features).
- **(B)** Leave alone; it works at this scale.

---

### G-3. No clear domain types or data-shape documentation
**Files:** Many places duplicate the shape of an "event":
- [supabase/migrations/20260423150500_live_site_support.sql:46-62](supabase/migrations/20260423150500_live_site_support.sql#L46-L62) (RPC return columns)
- [scripts/main.js:646-650, 699-783](scripts/main.js#L646-L650) (rendering `event.foo`)
- [scripts/content.js:42-282](scripts/content.js#L42-L282) (a *different* event shape used by the legacy mock data)

Two different "Event" shapes exist. `content.js` exports `events`, `eventScopeFilters`, `eventTimeFilters`, `eventSchedule`, `weeklyFeature` — none of which appear to be rendered any more by `main.js` (they're not imported).

**Better solution:**
- If `content.js` mock events are dead → delete them. ~250 lines disappear.
- If they're meant to be the empty-state filler → import them and render when the RPC returns 0.
- Define the live-event shape in one place (a JSDoc typedef or a TS `.d.ts`) and reference it from rendering code.

**Decision:**
- **(A)** Delete the dead mock data (low-risk cleanup).
- **(B)** Wire mock data as the empty-state visual.
- **(C)** Leave both; tag the dead code with a `// TODO: remove once production has events`.

---

### G-4. Admin decisions stored *only* in client `localStorage`
**File:** [scripts/admin-social.js:198-200](scripts/admin-social.js#L198-L200)

This is a deliberate choice ("decisions stay local until exported") but it has compounding problems:
- Two devices = two truth sources.
- Clearing browser data = lost decisions.
- No way for someone reviewing a publish to see *who* approved each draft.
- Export to JSON is a manual step to enable any audit.

**Better solution:**
- Persist decisions server-side in a `social_draft_decisions` table keyed by `(queue_file, draft_index)`. Edge function gates by admin email.
- Local cache stays as a quick-render layer; reconciles on load.
- "Export" becomes a download from the persisted state, not a localStorage dump.
- "Publish approved" reads from the table, not from a payload the client constructs.

**Decision:**
- **(A)** Move decisions server-side now (medium effort, high payoff).
- **(B)** Stay client-side; explicitly accept the single-admin model and document it.

---

### G-5. Approve/reject flow has no notion of an "expired" or "withdrawn" request
**File:** [supabase/migrations/20260423150500_live_site_support.sql:22-36](supabase/migrations/20260423150500_live_site_support.sql#L22-L36)

`event_approval_requests.status` is `('pending', 'approved', 'rejected')`. Real-life flows that aren't represented:
- Host cancels the event before admin gets to it → request is moot but still pending.
- Token sat untouched for 30 days → stale.
- Admin needs to send back ("needs more info") rather than approve/reject.

**Better solution:**
- Extend status: `('pending', 'approved', 'rejected', 'expired', 'withdrawn', 'returned_to_host')`.
- Add `expires_at` and a daily Postgres cron that flips pending→expired.
- Optionally a reviewer-comment column for "returned to host".

**Decision:**
- **(A)** Add `expires_at` + status expansion now (small migration).
- **(B)** Wait until the approval volume justifies it.

---

### G-6. Geolocation logic is conflated with rendering
**File:** [scripts/main.js:999-1051](scripts/main.js#L999-L1051)

`getBrowserLocation`, `locateEventsFromBrowser`, `autoLocateEvents`, plus `eventState.locationMode` / `locationNote` / `locating` are interleaved with the same module that does triangle-canvas animation, social-post rendering, and audience cards.

**Better solution:**
- Extract `scripts/events.js` covering only the events page (state, render, geolocation, RPC).
- Keep `main.js` for cross-page concerns (hero canvas, audience cards, social posts on the home page).
- This also lets `events.html` skip loading the home-page-only imports.

**Decision:**
- **(A)** Split `main.js` (clear win for maintainability; ~30 min effort).
- **(B)** Live with one-page-grow files for now.

---

## CORRECTNESS / UX GAPS

### G-7. There is no "this is an events list, with pagination" — radius and limit are silent and fixed
**Constants:** [scripts/main.js:40-41](scripts/main.js#L40-L41) `EVENT_RADIUS_KM = 50`, `EVENT_LIMIT = 50`

If a popular city has >50 events nearby, the user sees an arbitrary 50 with no indication of truncation, and no way to load more. Past 50 km, no events appear regardless of demand.

**Better solution:**
- Show "Showing N of approximately M" when the RPC reports total.
- Add "Load more" / "Show wider area" buttons.
- Or render a small map view to make truncation visually obvious.

**Decision:**
- **(A)** Add total counts + load-more (RPC needs a `count` column).
- **(B)** Today: silently capped.

---

### G-8. No filter UI even though `event-filters` element exists
**File:** [events.html](events.html) and [scripts/main.js:137-176](scripts/main.js#L137-L176)

`renderEventFilters` only renders the toolbar (heading + Refresh + Locate). There's no filter chip set for scope (local/city/global), no time filter (today/week/month), even though `content.js` exports `eventScopeFilters` and `eventTimeFilters` for exactly this purpose.

**Better solution:** Wire up actual filters → would also justify the `radius_km` and `limit` knobs.

**Decision:**
- **(A)** Add filters now (high product value, ~1 day work).
- **(B)** Defer until multi-city volume justifies it.

---

### G-9. The "Use current location" button fires geolocation without explaining what changes
**File:** [scripts/main.js:166-173](scripts/main.js#L166-L173)

The user clicks a button → they may or may not see a permission dialog → they may or may not see different events. No surrounding explanation.

**Better solution:** Add a one-line hint near the button: *"Re-detect your current location to see distances and refresh nearby events."*

---

### G-10. Distance is shown only when geolocation is granted, but distance from the *user* (not the event center)
**File:** [scripts/main.js:702, 731](scripts/main.js#L702)

If the user is in Manchester but searches "events in London", distances will be calculated from… London (because `eventState.center` is updated to the user's location when granted). There's no UX path to view events in a different city without going there.

**Better solution:**
- Add a city-search box that calls a geocoder and updates `eventState.center` independent of `locationMode`.
- Distance label could distinguish "distance from you" vs "distance from search center".

**Decision:**
- **(A)** Add city-search (high-effort, requires a geocoding service).
- **(B)** Keep "events near me only" model.

---

### G-11. `eventCardMarkup` re-renders the entire list on every state change
**File:** [scripts/main.js:869-958](scripts/main.js#L869-L958)

Every `setExpanded`, every Refresh, every locate, every registration-load wipes and rebuilds the DOM. Acceptable at 50 cards, but:
- Loses scroll position (mitigated by `scrollIntoView`, but only for the focused card).
- Drops in-progress text selection.
- Causes layout thrash + visible flicker on slow devices.

**Better solution:** Diff-based render or partial update — when only the expanded state changes, just toggle a class and slide in details.

**Decision:**
- **(A)** Refactor to partial updates (medium effort).
- **(B)** Live with full re-renders; cap card count in the meantime.

---

### G-12. No empty-state CTAs that lead anywhere useful
**Files:** [scripts/main.js:917-924](scripts/main.js#L917-L924), [scripts/leaderboard.js:113-114](scripts/leaderboard.js#L113-L114)

When there are no events, the message is *"Check back soon."* When the leaderboard has no players, *"No players yet."* Both are dead ends.

**Better solution:**
- Events empty state → "No events nearby. [Plan one] [Notify me]" linking to contact form / app deep-link.
- Leaderboard empty → link to "How scoring works" + "Join an event".

**Decision:**
- **(A)** Add CTAs (small copy + link change, big UX win).
- **(B)** Today.

---

### G-13. No telemetry on what events are clicked / shared
**File:** [scripts/main.js](scripts/main.js)

The contact form fires `contact_form_submitted`. Nothing tracks events page interactions: card opens, locate clicks, share clicks. With analytics off-by-default, this is moot today; once analytics is enabled there'll be no insight into the most important page.

**Better solution:**
- Add `events_card_opened`, `events_share_clicked`, `events_located_user` events (gated by consent).

**Decision:**
- **(A)** Add minimal events-page telemetry.
- **(B)** Wait until analytics is turned on broadly.

---

### G-14. The leaderboard has tabs but no clear "How is this scored?" disclosure
**File:** [leaderboard.html](leaderboard.html) (not read in detail, but no link in render code)

A user looking at "Local players" with no context sees a list of names+points and may distrust it. No methodology link.

**Better solution:** Small "How are scores calculated?" link beneath the tab row → opens a modal or scrolls to an explainer.

---

### G-15. Contact form analytics consent overrides the global consent silently
Already in [02-edge-cases.md#E-16](reviews/02-edge-cases.md). Worth listing here as a logical gap: a per-form checkbox that doubles as a global setting violates the principle of least surprise.

---

## DEPLOYMENT / DEV-EXPERIENCE GAPS

### G-16. No automated way to deploy edge functions
**File:** No CI workflow.

The Supabase CLI (`supabase functions deploy`) needs to be run manually. Nothing in this repo's `.git` or scripts runs it. Risk: a bug fix to an edge function gets pushed to GitHub but never deployed.

**Better solution:**
- Add `.github/workflows/deploy-functions.yml` that runs `supabase functions deploy` for changed files on push to `main`.
- Add `supabase db push` in the same workflow (gated on a label or manual trigger to avoid accidental migrations).

**Decision:**
- **(A)** Add automated deploy.
- **(B)** Manual deploy + a checklist in `docs/`.

---

### G-17. No staging environment
The same Supabase project serves dev and prod. Any migration / function deploy lands directly on production.

**Better solution:**
- Use Supabase's [branching feature](https://supabase.com/docs/guides/platform/branching) for PRs.
- Or maintain a second project (`triangulate-live-site-staging`) and use environment-specific config.

**Decision:**
- **(A)** Adopt Supabase branching (simplest).
- **(B)** Stand up a staging project (more isolation, more cost).
- **(C)** Stay single-environment until a deploy goes wrong (today).

---

### G-18. Missing types: the codebase is plain JS but the edge functions are TS
The frontend benefits from no type-checking. Several places already have type-coercion bugs (B-9, B-10) that TS would catch.

**Better solution:**
- Add JSDoc typedefs (cheap; `// @ts-check` per file enables editor checks without a build step).
- Or migrate frontend modules to TS with `tsc --noEmit` in CI.

**Decision:**
- **(A)** JSDoc + `// @ts-check` (zero build-step overhead).
- **(B)** Full TS migration.
- **(C)** Stay JS.

---

### G-19. No tests of any kind
- No unit tests on date-formatting, distance label, escape-html.
- No integration test of the publish flow.
- No smoke test that pages render.

**Better solution:**
- Add a tiny test file for the pure helper functions in `main.js` (they're already mostly pure).
- Add Playwright smoke tests on `/`, `/events.html`, `/leaderboard.html`, `/contact.html`.

**Decision:**
- **(A)** Add unit tests for pure helpers (~2 hours).
- **(B)** Add Playwright smokes (~half day).
- **(C)** Skip tests; rely on manual QA.

---

### G-20. No defensive ESLint / Prettier config
Stylistic drift between modules: some use `import "./foo.js"`, some use functions, some use IIFEs implicitly via top-level execution. A formatter would normalise.

**Decision:**
- **(A)** Add Prettier config.
- **(B)** Skip.

---

## "BETTER SOLUTION" — FOCUSED REWRITES THAT WOULD PAY OFF

### G-21. Single deployable artifact
**Today:** Static HTML pages each loading their own bundle of `<script type="module">` tags + a non-module nav script.
**Better:** A simple `esbuild` step that bundles per-page + emits hashed filenames + injects into the HTML. Eliminates the cache-bust drift problem (R-18, E-42) and shrinks payloads. ~50 lines of build script.

### G-22. Move all "data sync" CLI scripts (`scripts/social_*.mjs`) out of the public `scripts/` directory
**Today:** The web `scripts/` directory and CLI utility `scripts/social_*.mjs` share a folder, which is confusing and (more importantly) means the static host might serve them publicly.
**Better:** Move CLI utilities to `tools/` or `bin/`. Web-loaded modules stay in `scripts/`.

### G-23. Replace the `decisions in localStorage` model with a thin "review server" view
Already covered in G-4. Reframing here as the *better* solution: a single dashboard with server-backed state, a publish queue, and a server-rendered audit log makes every other concern (multi-admin, history, retries) trivial.

---

## Summary of decisions you need to make

| # | Gap | Recommended decision |
|---|---|---|
| G-1 | Two-Supabase project boundary | (A) Live-site is canonical for website concerns |
| G-3 | Dead mock event data in `content.js` | (A) Delete |
| G-4 | Decisions in localStorage | (A) Server-side persist |
| G-5 | Approval lifecycle (no expiry/withdrawn) | (A) Add `expires_at` + new statuses |
| G-6 | Single oversized `main.js` | (A) Split events code into its own file |
| G-7 | No event pagination indication | (A) Show counts and load-more |
| G-8 | No filter UI on events page | (A) Wire scope+time filters |
| G-10 | No city-search beyond geolocate | Defer (B) |
| G-12 | Empty states are dead ends | (A) Add CTAs |
| G-13 | No events-page telemetry | (A) Add gated events |
| G-16 | No automated deploy | (A) Add CI deploy workflow |
| G-17 | No staging | (A) Supabase branching |
| G-18 | No types | (A) JSDoc + `// @ts-check` |
| G-19 | No tests | (A) Add unit tests for pure helpers |
| G-21 | No build step | (A) Tiny esbuild bundle |
| G-22 | CLI tools mixed with web modules | Mechanical move |

Anything not in the table above is a "do whichever you like" cleanup.
