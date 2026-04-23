# Social Agent

The Phase 1 social agent creates reviewable drafts only. It does not log in to Instagram or TikTok, does not post, does not comment, and does not like anything.

## Run

```sh
node scripts/social_content_agent.mjs
```

Offline/sample mode:

```sh
node scripts/social_content_agent.mjs --offline
```

The output is written to `social-agent/out/` as JSON and Markdown. That folder is ignored by Git because each run is an approval queue, not source code.

## What It Creates

- TikTok draft scripts.
- Instagram Reel draft scripts.
- Instagram Story frame copy.
- Carousel ideas.
- Lead research searches for Instagram/TikTok.
- Suggested comments for manual review.

Every item is marked `needs_approval`. The agent is intentionally safe-by-default:

- Auto-posting is off.
- Auto-comments are off.
- Auto-likes are off.
- Player names and player stats are excluded.
- Public content talks about events, venues, game format, and movement.

## Event Data

The script tries to fetch public events from Supabase using:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

It checks shell environment variables first, then `.env`, then `scripts/site-config.js` if present.

If live events cannot be loaded, it falls back to safe sample event ideas so the queue still works.

## Next Phase

Once the manual queue is useful, the next step is connecting official platform access:

- TikTok Content Posting API for owned TikTok posts.
- Meta/Instagram APIs for owned Instagram publishing and analytics.

Engagement with other accounts should stay manual-approval unless official API support and account-risk limits are confirmed.
