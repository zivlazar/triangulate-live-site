create table if not exists public.website_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  phone_number text,
  company_name text,
  query text not null,
  analytics_consent boolean not null default false,
  response_consent boolean not null default false,
  source_page text,
  referrer text,
  tracking_context jsonb not null default '{}'::jsonb,
  email_sent boolean not null default false,
  admin_email_sent boolean not null default false,
  user_agent text,
  ip_hash text
);

alter table public.website_feedback enable row level security;

create table if not exists public.event_approval_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  title text not null default 'Meet up',
  host text not null default 'Someone',
  scheduled text not null default 'Whenever works',
  plan_note text,
  event_payload jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  rejected_at timestamptz,
  handled_at timestamptz,
  handled_action text
);

alter table public.event_approval_requests enable row level security;

create or replace function public.list_public_events_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 50,
  p_limit integer default 50
)
returns table (
  id text,
  title text,
  plan_note text,
  scheduled_for timestamptz,
  status text,
  cancelled_at timestamptz,
  meeting_point_name text,
  meeting_point_parent_name text,
  meeting_point_postcode text,
  meeting_point_photo_url text,
  distance_m double precision,
  registration_count integer,
  team_member_count integer,
  creator_nickname text,
  team_name text
)
language sql
stable
as $$
  select
    null::text as id,
    null::text as title,
    null::text as plan_note,
    null::timestamptz as scheduled_for,
    null::text as status,
    null::timestamptz as cancelled_at,
    null::text as meeting_point_name,
    null::text as meeting_point_parent_name,
    null::text as meeting_point_postcode,
    null::text as meeting_point_photo_url,
    null::double precision as distance_m,
    null::integer as registration_count,
    null::integer as team_member_count,
    null::text as creator_nickname,
    null::text as team_name
  where false;
$$;

create or replace function public.get_event_registrations(
  p_event_id text,
  p_viewer_player_id text default null
)
returns table (
  player_id text,
  nickname text,
  status text,
  color text
)
language sql
stable
as $$
  select
    null::text as player_id,
    null::text as nickname,
    null::text as status,
    null::text as color
  where false;
$$;

create or replace function public.get_my_bracket(
  p_player_id text,
  p_period text default 'week',
  p_include_test boolean default false
)
returns table (
  player_id text,
  rank integer,
  nickname text,
  score integer,
  rank_change integer,
  is_me boolean,
  city text,
  country text,
  last_event text,
  local_area text,
  last_event_date text
)
language sql
stable
as $$
  select
    null::text as player_id,
    null::integer as rank,
    null::text as nickname,
    null::integer as score,
    null::integer as rank_change,
    null::boolean as is_me,
    null::text as city,
    null::text as country,
    null::text as last_event,
    null::text as local_area,
    null::text as last_event_date
  where false;
$$;
