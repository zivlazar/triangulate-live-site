# Report 3 — Risk Review

**Scope:** Security, data, ops, and resilience risks across the live-site stack.
**Date:** 2026-04-25

Each risk is rated by **likelihood × impact** as **High / Medium / Low** with a **mitigation** and a **decision option**.

---

## SECURITY — AUTH & ACCESS

### R-1. Single hardcoded admin email — operational SPOF
**Severity: HIGH (impact), LOW (likelihood)**
**Files:** [scripts/admin-social.js:4](scripts/admin-social.js#L4), [supabase/functions/social-publish-approved/index.ts:75](supabase/functions/social-publish-approved/index.ts#L75), [supabase/functions/social-publish-settings/index.ts:73](supabase/functions/social-publish-settings/index.ts#L73)

`triangulate.game@gmail.com` is the only admin everywhere — frontend, two edge functions, and email defaults. If that account is compromised, locked out, or you want to add a second admin (delegate publishing), you'd have to redeploy code.

**Mitigations:**
- **(A)** Create a `public.admin_emails` table; functions check membership instead of comparing strings. Frontend checks via a `whoami` function. (Recommended.)
- **(B)** Use Supabase row-level role claims (custom JWT claims) to mark admin users.
- **(C)** Today's hardcode — fine for a single-admin product, accept the risk.

**Decision needed.**

---

### R-2. Magic-link token written to `sessionStorage` before email is verified
**Severity: MEDIUM**
**File:** [scripts/admin-social.js:103-117](scripts/admin-social.js#L103-L117)

Already in [01-bugs.md#B-15](reviews/01-bugs.md). Repeated here because it's also a security risk: any same-origin XSS during that brief window can grab the token *even if the user is not the admin*. The token has Supabase's TTL (typically 1h), enabling impersonation.

**Mitigation:** Verify before persisting (see B-15).

---

### R-3. Anon Supabase key + URL committed to git
**Severity: LOW (publishable design) but warrants attention**
**File:** [scripts/site-config.js:1-3](scripts/site-config.js#L1-L3)

This is a publishable anon key by design — Supabase says this is fine *if* RLS is enforced everywhere. However, the site exposes the project URL too, so anyone can probe the schema. Risk depends entirely on RLS coverage.

**Status of RLS in this project:**
- ✅ `website_feedback` — RLS enabled (no policy = nothing readable, edge function uses service role).
- ✅ `event_approval_requests` — RLS enabled (no policy = nothing readable directly).
- ✅ `social_publish_settings` — RLS enabled with explicit "no direct access" policy.

**Concerns:**
- The three RPC functions (`list_public_events_near`, `get_event_registrations`, `get_my_bracket`) are `STABLE` SQL functions that anyone with the anon key can invoke. They currently return zero rows, but if/when the real bodies are deployed (B-2), they need to be carefully reviewed:
  - Do they leak private events?
  - Can a viewer pass any `p_player_id` to `get_my_bracket` and see anyone's bracket? **(Likely yes today — there's no auth check inside the SQL function.)**

**Decision needed.**
- **(A)** Audit/lock down the real bodies of these RPCs when they ship — restrict `get_my_bracket` to the calling user's player ID only (or document that bracket is public by design).
- **(B)** Move read RPCs behind an edge function so you can authenticate the caller.

---

### R-4. CORS is `*` on every edge function
**Severity: MEDIUM**
**Files:** All four edge functions, e.g. [supabase/functions/website-feedback/index.ts:1-5](supabase/functions/website-feedback/index.ts#L1-L5)

`Access-Control-Allow-Origin: *` permits any origin to invoke these endpoints from the browser:
- `website-feedback` — anyone can submit feedback at scale (free use of your Resend quota & DB rows).
- `social-publish-approved` — auth-gated, but probing for behavior costs you function invocations.
- `social-publish-settings` — auth-gated.
- `event-approval-confirm` — token-gated; brute-forcing is impractical with 240-char tokens, but probing endpoints from any origin is wasteful.

**Mitigations:**
- **(A)** Replace `*` with an allow-list (`https://triangulate.live`, plus the deploy preview origin).
- **(B)** Add a basic rate limiter per IP (e.g. via [Upstash](https://upstash.com/) or a Postgres-backed counter).
- **(C)** Today's behavior + monitor for abuse.

**Decision needed.**

---

### R-5. No rate limiting on `website-feedback`
**Severity: MEDIUM**
**File:** [supabase/functions/website-feedback/index.ts](supabase/functions/website-feedback/index.ts)

A bot can flood the function. Honeypot catches naïve scrapers but not anyone reading the DOM. Each accepted submission costs:
- One DB write
- Two Resend emails (one to user, one to admin)
- One function invocation

A few thousand bad submissions = blown email quota and admin inbox flooded.

**Mitigations:**
- **(A)** Add a per-IP rate limiter (e.g. 5/hour). Hash IP for storage.
- **(B)** Cloudflare Turnstile or hCaptcha on the form.
- **(C)** Today's behavior + monitor.

**Decision needed.**

---

### R-6. Admin email enumeration via login form
**Severity: LOW**
**File:** [admin-social.html:73](admin-social.html#L73)

The admin email is pre-filled as the input's `value`. Anyone viewing the source learns who can log in → spear-phishing target.

**Mitigation:** Don't pre-fill; let the admin type or remember it.

---

## SECURITY — DATA HANDLING

### R-7. Publish tokens (Instagram, TikTok) stored at rest in `social_publish_settings`
**Severity: MEDIUM**
**File:** [supabase/migrations/20260423174000_social_publish_settings.sql](supabase/migrations/20260423174000_social_publish_settings.sql)

Tokens are stored in plain `text` columns. RLS blocks direct access, but:
- A leaked service-role key reads them in plaintext.
- DB backups carry tokens.
- Anyone with project console access (Supabase dashboard) sees them.

**Mitigations:**
- **(A)** Encrypt at column level using `pgsodium` / Vault (Supabase has [supported integrations](https://supabase.com/docs/guides/database/extensions/pgsodium)).
- **(B)** Move tokens to Supabase Vault and reference by id.
- **(C)** Today's behavior — accept the trust boundary on the service-role key + dashboard auth.

**Decision needed.**

---

### R-8. `tracking_context` accepts arbitrary JSON from any origin
**Severity: LOW**
**File:** [supabase/functions/website-feedback/index.ts:48-50](supabase/functions/website-feedback/index.ts#L48-L50)

```ts
tracking_context: payload.trackingContext && typeof payload.trackingContext === "object"
  ? payload.trackingContext
  : {},
```

A bot could stuff arbitrary structured data (e.g. multi-MB nested objects) into this field. The DB column is `jsonb` with no size limit. Could bloat rows.

**Mitigation:** Cap `JSON.stringify(tracking_context).length` at, say, 4 KB.

---

### R-9. `phone_number`, `company_name`, `email` stored as plaintext in PII table
**Severity: MEDIUM (compliance)**
**File:** [supabase/migrations/20260423150500_live_site_support.sql:1-18](supabase/migrations/20260423150500_live_site_support.sql#L1-L18)

`website_feedback` rows contain personally identifiable information indefinitely. UK GDPR concerns:
- No retention policy.
- No right-to-erasure mechanism.
- No `ip_hash` is actually populated (column exists, never written by the function — see [website-feedback/index.ts:38-52](supabase/functions/website-feedback/index.ts#L38-L52)).

**Mitigations:**
- **(A)** Add a scheduled job to delete or pseudonymise rows older than (e.g.) 90 days.
- **(B)** Add an erasure endpoint admins can call.
- **(C)** At minimum, populate `ip_hash` with a salted hash of the X-Forwarded-For so logs aren't lost when you eventually delete rows.
- **(D)** Document retention in the privacy policy.

**Decision needed** — at minimum, you should pick a retention window and write it into the privacy policy.

---

### R-10. No CSP, no SRI on third-party scripts
**Severity: LOW-MEDIUM**
**Files:** [contact.html](contact.html), [index.html](index.html), [admin-social.html](admin-social.html), [scripts/site-core.js](scripts/site-core.js)

The site loads:
- Google Fonts CSS (every page)
- Mixpanel CDN (`cdn.mxpnl.com`) — when analytics consent granted
- Google Analytics gtag (`googletagmanager.com`) — when analytics consent granted

No CSP header (would need to be set by GitHub Pages / hosting). No SRI hashes on the script tags. If any of those CDNs are compromised → silent supply-chain attack on every visitor.

**Mitigations:**
- **(A)** Add a `<meta http-equiv="Content-Security-Policy" content="…">` tag with a strict allow-list.
- **(B)** Add SRI to the few static script tags (font CSS doesn't need SRI; gtag/mixpanel inject inline so SRI is awkward — CSP is the better lever).
- **(C)** Today's behavior — accept the supply-chain risk for these well-known CDNs.

**Decision needed.**

---

### R-11. Outbound Referer leaks token on the approve-event success page
**Severity: LOW**
**File:** [approve-event.html:131, 140](approve-event.html#L131)

The success page URL still has `?token=…&action=…`. The "Back to Triangulate" link, when followed, sends the full URL as `Referer`. After server marks the row terminal, the token is dead — but tokens are valid until used, and a quick double-click could leak before the marking.

**Mitigation:** `<meta name="referrer" content="strict-origin">` in the page head, or `referrerpolicy="no-referrer"` on the link.

---

## OPS & RESILIENCE

### R-12. Two Supabase projects; unclear which owns what
**Severity: HIGH (cognitive load + bug surface)**
**Files:** [scripts/site-config.js:1](scripts/site-config.js#L1) (live-site project) vs [approve-event.html:107](approve-event.html#L107) (game project)

Already covered in [01-bugs.md#B-1](reviews/01-bugs.md). Beyond the immediate bug, this split between **live-site Supabase** (`wnkbkgnydrmwgudbdqin`) and **game Supabase** (`rgczribfoutvpashjgrx`) creates ongoing risk:
- Migrations diverge.
- Auth users diverge (admin must exist in both).
- Service-role keys diverge.
- Edge function versions can drift.

**Decision needed.**
- **(A)** Pick one project as canonical for live-site concerns; document boundaries clearly.
- **(B)** Write a single deploy script that updates both projects in lock-step for shared concerns.

---

### R-13. No structured logging; no error reporting (Sentry, etc.)
**Severity: MEDIUM**
**Files:** All edge functions and frontend JS

When `social-publish-approved` returns `failed`, the only record is the response body. No persistent error log. No alerts when admin email send fails. No monitoring of RPC error rates.

**Mitigations:**
- **(A)** Send all `console.error` and edge-function failures to Sentry / a logging endpoint.
- **(B)** Persist failures into a `function_errors` table for periodic review.
- **(C)** Today's blind spot.

**Decision needed.**

---

### R-14. No backup or rollback of `social_publish_settings`
**Severity: LOW**
**File:** [supabase/functions/social-publish-settings/index.ts:96-119](supabase/functions/social-publish-settings/index.ts#L96-L119)

A bad save (admin pastes the wrong token) overwrites the previous value with no undo. Supabase has point-in-time DB recovery, but rolling back a single row is operationally heavy.

**Mitigation:** Append a history row to a `social_publish_settings_history` table on each save.

---

### R-15. No health check / canary
**Severity: LOW**

If the leaderboard RPC silently starts returning malformed data, the only signal is users complaining. No synthetic check.

**Mitigation:** Daily cron / external uptime check that hits `events.html` and `leaderboard.html`, asserts the grids contain rows.

---

### R-16. Leaderboard refreshes every 30 s in every open tab
**Severity: LOW (cost + scaling)**
**File:** [scripts/leaderboard.js:237](scripts/leaderboard.js#L237)

If a user leaves the leaderboard tab open all day, that's 2,880 RPC calls/day per tab. Acceptable today; will matter at scale.

**Mitigations:**
- **(A)** Pause polling when `document.hidden`.
- **(B)** Increase interval to 2–5 min; add a manual refresh button.
- **(C)** Switch to Supabase Realtime subscriptions for live updates.

---

### R-17. `setInterval` is never cleared
**File:** [scripts/leaderboard.js:237](scripts/leaderboard.js#L237) — already covered in [01-bugs.md#B-14](reviews/01-bugs.md). Long-tab tabs leak handlers. Mitigation: clear on `pagehide`.

---

### R-18. Cache-bust query params drift between pages
Already covered in [02-edge-cases.md#E-42](reviews/02-edge-cases.md). Risk side: deploys can land in production with a mix of old/new HTML and CSS, breaking layouts mid-rollout. Centralised version stamp recommended.

---

### R-19. No CI / no automated checks
**Severity: MEDIUM**

No GitHub Actions workflow. No type-checking, no lint, no test. Every deploy is hand-verified. Easy to ship a broken build.

**Mitigations:**
- **(A)** Add a minimal CI: `node --check` for JS files, `deno check` for `.ts`, `psql --dry-run` (or `supabase db lint`) for migrations.
- **(B)** Add Playwright smoke tests on key pages.
- **(C)** Today's manual flow.

**Decision needed.**

---

## EXTERNAL DEPENDENCIES

### R-20. Resend single-tenant
**Severity: MEDIUM**
**File:** [supabase/functions/website-feedback/index.ts:69-83](supabase/functions/website-feedback/index.ts#L69-L83)

If Resend has an outage or the domain is suspended, contact form submissions are saved but no notification reaches you. (See E-13.)

**Mitigation:** Add Slack/Discord webhook as a secondary alert path.

---

### R-21. Instagram Graph API and TikTok Content Posting API both in flux
**Severity: MEDIUM**

Both APIs are subject to:
- Token expiry / re-auth requirements (TikTok = 24h refresh).
- Permission-scope changes (Meta routinely deprecates).
- Audit-required changes (TikTok PUBLIC posts).

**Mitigation:**
- Schedule a quarterly review of API versions.
- Catch and surface 401 errors specifically with "token expired — please re-authenticate" messaging.

---

### R-22. Mixpanel + Google Analytics on a privacy-first product
**Severity: LOW (compliance)**
**File:** [scripts/site-core.js](scripts/site-core.js)

Currently `mixpanelToken` and `googleMeasurementId` are empty strings ⇒ analytics is dormant. When you enable them:
- The privacy policy needs updating to name both vendors.
- Cookie banner is opt-in only ✅ (good).
- Mixpanel `persistence: "localStorage"` instead of cookies ✅ (good).

**Decision:** Document privacy implications when you enable analytics.

---

## OPERATIONAL — DATA INTEGRITY

### R-23. `event_approval_requests` and `event_payload` are never used in render
**Severity: LOW**

The `event_payload jsonb` column is filled by upstream but never displayed back to the admin in `approve-event.html` (the page only shows `title`, `host`, `scheduled`, `plan_note`). If the payload is meant to inform the decision, the admin is operating without it.

**Mitigation:** Either remove the column or surface its summary on the approval page.

---

### R-24. No audit trail for publish decisions
**Severity: MEDIUM**

The `social-publish-approved` function returns results but doesn't persist what was published. If a bad post goes out, there's no DB row to query — only the local `localStorage` decisions and the admin's downloaded JSON export.

**Mitigations:**
- **(A)** Insert a `social_publish_log` row per draft attempt (success and failure).
- **(B)** Today's "export decisions" workflow + manual archiving.

**Decision needed.**

---

## Summary of decisions you need to make

| # | Risk | Recommended decision |
|---|---|---|
| R-1 | Single hardcoded admin | Move to a table-based admin list |
| R-3 | RPC body audit when shipped | Audit + lock down `get_my_bracket` |
| R-4 | CORS `*` | Allow-list `triangulate.live` |
| R-5 | No rate-limit on contact form | Add a per-IP throttle or Turnstile |
| R-7 | Publish tokens at rest | Decide: pgsodium vs accept |
| R-9 | PII retention | Pick a retention window (90 days?) and document |
| R-10 | CSP / SRI | Add a basic CSP meta tag |
| R-12 | Two-Supabase-project split | Pick canonical, document boundaries |
| R-13 | No error reporting | Add Sentry or structured log endpoint |
| R-19 | No CI | Add minimal CI: deno check + node --check |
| R-24 | No publish audit trail | Persist results to `social_publish_log` |

The remaining risks (R-2, R-6, R-8, R-11, R-14, R-15, R-16, R-17, R-18, R-20, R-21, R-22, R-23) are mechanical hardening you can ship without strategy choices.
