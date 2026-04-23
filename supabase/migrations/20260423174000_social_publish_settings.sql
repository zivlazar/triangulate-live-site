create table if not exists public.social_publish_settings (
  id integer primary key default 1 check (id = 1),
  dry_run boolean not null default true,
  instagram_access_token text,
  instagram_user_id text,
  instagram_graph_base text not null default 'https://graph.facebook.com/v24.0',
  tiktok_access_token text,
  tiktok_privacy_level text not null default 'SELF_ONLY',
  tiktok_disable_duet boolean not null default false,
  tiktok_disable_comment boolean not null default false,
  tiktok_disable_stitch boolean not null default false,
  tiktok_brand_content_toggle boolean not null default false,
  tiktok_brand_organic_toggle boolean not null default true,
  tiktok_is_aigc boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by_email text
);

insert into public.social_publish_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.social_publish_settings enable row level security;

drop policy if exists "No direct social publish settings access" on public.social_publish_settings;
create policy "No direct social publish settings access"
on public.social_publish_settings
for all
to anon, authenticated
using (false)
with check (false);
