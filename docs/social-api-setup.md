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

- Auto-commenting.
- Auto-liking.

Those require additional permissions, platform review, and stronger approval controls.

## Admin Approval And Publishing

The website includes `admin-social.html` for reviewing generated social drafts.

Publish the latest generated queue to the dashboard data file:

```sh
node scripts/social_publish_queue.mjs
```

The dashboard signs in `triangulate.game@gmail.com` with Supabase email auth, reads
`data/social-approval-queue.json`, and stores approval decisions in the browser until exported.

Direct publishing is routed through the Supabase Edge Function at:

```text
social-publish-approved
```

Deploy it from the repo root after logging into an account with access to the live project:

```sh
supabase login
supabase link --project-ref wnkbkgnydrmwgudbdqin
supabase functions deploy social-publish-approved --project-ref wnkbkgnydrmwgudbdqin --use-api
```

Set secrets with `supabase secrets set` before turning dry-run off:

```sh
supabase secrets set ADMIN_EMAIL=triangulate.game@gmail.com --project-ref wnkbkgnydrmwgudbdqin
supabase secrets set SOCIAL_PUBLISH_DRY_RUN=true --project-ref wnkbkgnydrmwgudbdqin
```

Required Supabase function secrets:

- `ADMIN_EMAIL`, defaults to `triangulate.game@gmail.com`.
- `SUPABASE_URL`.
- `SUPABASE_ANON_KEY`.
- `SOCIAL_PUBLISH_DRY_RUN`, defaults to `true`. Set to `false` only after testing.

Instagram publishing secrets:

- `INSTAGRAM_ACCESS_TOKEN`.
- `INSTAGRAM_USER_ID`, or `INSTAGRAM_BUSINESS_ACCOUNT_ID`.
- `INSTAGRAM_GRAPH_BASE`, optional. Defaults to `https://graph.facebook.com/v24.0`.

TikTok publishing secrets:

- `TIKTOK_ACCESS_TOKEN`, with the `video.publish` scope.
- `TIKTOK_PRIVACY_LEVEL`, defaults to `SELF_ONLY`.
- Optional toggles: `TIKTOK_DISABLE_DUET`, `TIKTOK_DISABLE_COMMENT`, `TIKTOK_DISABLE_STITCH`,
  `TIKTOK_BRAND_CONTENT_TOGGLE`, `TIKTOK_BRAND_ORGANIC_TOGGLE`, and `TIKTOK_IS_AIGC`.

Publishing notes:

- The browser never receives Instagram or TikTok access tokens.
- Approved drafts need a public HTTPS media URL before direct publishing.
- TikTok direct posting uses `PULL_FROM_URL`, so the media URL prefix/domain must be verified in the TikTok developer app.
- Instagram direct publishing currently handles single image posts and Reels. Stories and carousels stay manual until separate publishing support is added.
- TikTok unaudited clients may be restricted to private visibility, and platform app review may be required before public posting.

## Official Docs

- TikTok Display API overview: https://developers.tiktok.com/doc/display-api-overview/
- TikTok video list endpoint: https://developers.tiktok.com/doc/tiktok-api-v2-video-list/
- TikTok Content Posting API: https://developers.tiktok.com/products/content-posting-api/
- TikTok Direct Post API: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post/
- Instagram Platform APIs: https://developers.facebook.com/products/instagram/apis/
- Instagram Platform docs: https://developers.facebook.com/docs/instagram-platform/
- Instagram Content Publishing: https://developers.facebook.com/docs/instagram-api/guides/content-publishing/
