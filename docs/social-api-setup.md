# Social API Setup

The website must not expose Instagram or TikTok access tokens in browser JavaScript. API calls run at build time or locally, then write public post metadata to `data/social-posts.json`. The homepage reads that static JSON.

## Required Secrets

Instagram:

- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_USER_ID`
- `INSTAGRAM_GRAPH_BASE`, optional. Defaults to `https://graph.instagram.com/v22.0`. Use `https://graph.facebook.com/v24.0` if the token/account is connected through Instagram Graph API with Facebook Login.

TikTok:

- `TIKTOK_ACCESS_TOKEN`, with the `video.list` scope.

Optional:

- `SOCIAL_POST_LIMIT`, defaults to `8`.

## Redirect URIs

Use these exact redirect URIs in the developer portals:

- TikTok: `https://triangulate.live/auth/tiktok/callback/`
- Instagram: `https://triangulate.live/auth/instagram/callback/`

The trailing slash matters on GitHub Pages because each callback is served from an `index.html` file inside that folder.

## Local Check

Create `.env` from `.env.example`, then run:

```sh
node scripts/social_api_status.mjs
```

Sync posts:

```sh
node scripts/social_sync_posts.mjs
```

Dry run:

```sh
node scripts/social_sync_posts.mjs --dry-run
```

## What Is Connected

- Instagram owned media list, used for surfacing public brand-owned posts on the homepage.
- TikTok owned video list, used for surfacing public brand-owned videos on the homepage.

## What Is Not Connected Yet

- Auto-posting to Instagram or TikTok.
- Auto-commenting.
- Auto-liking.

Those require additional permissions, platform review, and stronger approval controls.

## Official Docs

- TikTok Display API overview: https://developers.tiktok.com/doc/display-api-overview/
- TikTok video list endpoint: https://developers.tiktok.com/doc/tiktok-api-v2-video-list/
- TikTok Content Posting API: https://developers.tiktok.com/products/content-posting-api/
- Instagram Platform APIs: https://developers.facebook.com/products/instagram/apis/
- Instagram Platform docs: https://developers.facebook.com/docs/instagram-platform/
