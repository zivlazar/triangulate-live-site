# Triangulate Live Site

## Copy Rules

- Never mention backend systems, databases, APIs, sync processes, data pipelines, or implementation details in public-facing website copy.
- Never explain where website content/data comes from or how it flows between the website and any other product.
- Keep website copy focused on the user experience, the events/content themselves, and clear product-facing language.
- If a sentence is mainly explaining technical plumbing rather than helping a visitor understand the product, rewrite or remove it.
- Public event surfaces must never disclose registered player names, player IDs, or organiser names. Show only aggregate counts such as "3 going". Player names are allowed only in explicit direct communication flows, not public event boards or event details.

## Supabase backends

The site talks to two Supabase projects, configured in `scripts/site-config.js`:

- `SUPABASE_URL` → `wnkbkgnydrmwgudbdqin` — **this site's own backend** (waitlist, contact/feedback, admin event-approval, social-publish), served by the edge functions under `supabase/functions/`.
- `GAME_SUPABASE_URL` → `rgczribfoutvpashjgrx` — the game project; **read-only** from here (leaderboard only).

### Keep-alive — do not remove

`.github/workflows/keepalive.yml` pings the `wnkbkgnydrmwgudbdqin` REST API once a day (06:17 UTC) using repo secret `SUPABASE_ANON` (the public anon key). Free-tier Supabase projects **auto-pause after ~7 days** with no external activity, and a pause breaks the waitlist, contact form, admin approvals, and social-publish. **Do not delete this workflow or its secret.** If the repo goes 60+ days without commits, GitHub auto-disables scheduled workflows — re-enable from the Actions tab, or move the ping to an external service (e.g. cron-job.org).
