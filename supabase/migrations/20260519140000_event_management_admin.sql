-- Event management admin portal — schema
--
-- Backs the /admin-events.html dashboard. Models a typical event-management
-- operation built around Triangulate's 3v3 outdoor format:
--
--   venues  ─┐
--            ├──< events ──< event_registrations >── participants
--   teams ───┘                       │
--                                    └── event_feedback / comms_log
--
-- Auth posture:
--   - Admin allowlist lives in public.admin_users (email column).
--   - RLS on every admin table: only authenticated users whose email is
--     in admin_users may read/write. anon role gets nothing.
--   - service_role retains full access for edge functions + seed loads.
--   - public.is_admin_user() helper centralises the JWT check so policies
--     stay readable and consistent.

set check_function_bodies = off;

-- ─── Admin allowlist ────────────────────────────────────────────────────────

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  role text not null default 'admin' check (role in ('admin', 'viewer', 'organiser')),
  created_at timestamptz not null default now()
);

insert into public.admin_users (email, display_name, role)
values
  ('triangulate.game@gmail.com', 'Triangulate Ops', 'admin'),
  ('ziv1.lazar@gmail.com', 'Ziv Lazar', 'admin')
on conflict (email) do nothing;

-- Helper: returns true iff the calling user's JWT email is on the admin list.
create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin_user() from public;
grant execute on function public.is_admin_user() to anon, authenticated, service_role;

-- ─── Venues ─────────────────────────────────────────────────────────────────

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_line text,
  city text,
  postcode text,
  region text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  capacity int,
  surface text check (surface in ('grass', 'tarmac', 'sand', 'mixed', 'gravel') or surface is null),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists venues_city_idx on public.venues (city);

-- ─── Events ─────────────────────────────────────────────────────────────────

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  description text,
  event_type text not null default 'session' check (
    event_type in ('session', 'tournament', 'open_day', 'training', 'partner', 'press')
  ),
  status text not null default 'draft' check (
    status in ('draft', 'scheduled', 'live', 'completed', 'cancelled', 'postponed')
  ),
  cohort text check (cohort in ('A', 'B', 'mixed') or cohort is null),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  doors_at timestamptz,
  venue_id uuid references public.venues(id) on delete set null,
  city text,
  capacity int not null default 24,
  waitlist_capacity int not null default 12,
  price_pence int not null default 0,
  age_min int,
  age_max int,
  weather_call text check (weather_call in ('go', 'monitor', 'hold', 'cancel') or weather_call is null),
  organiser_email text,
  organiser_name text,
  cover_image_url text,
  external_event_url text,
  tags text[] not null default '{}',
  notes text,
  cancellation_reason text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists events_status_idx on public.events (status);
create index if not exists events_starts_at_idx on public.events (starts_at desc);
create index if not exists events_city_idx on public.events (city);
create index if not exists events_cohort_idx on public.events (cohort);

-- ─── Participants ───────────────────────────────────────────────────────────

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  display_name text,
  phone_number text,
  city text,
  postcode text,
  segment text not null default 'player' check (
    segment in ('player', 'coach', 'parent', 'observer', 'press', 'partner', 'staff')
  ),
  source text check (
    source in ('waitlist', 'direct', 'referral', 'partner', 'press', 'walk_in', 'import') or source is null
  ),
  cohort text check (cohort in ('A', 'B') or cohort is null),
  dob_year int,
  consent_marketing boolean not null default false,
  consent_photo boolean not null default false,
  notes text,
  attio_person_id text,
  mixpanel_distinct_id text,
  total_events_attended int not null default 0,
  total_no_shows int not null default 0,
  lifetime_value_pence int not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email)
);

create index if not exists participants_segment_idx on public.participants (segment);
create index if not exists participants_city_idx on public.participants (city);
create index if not exists participants_cohort_idx on public.participants (cohort);
create index if not exists participants_last_seen_idx on public.participants (last_seen_at desc);

-- ─── Teams (one per event, 3-player triangle) ───────────────────────────────

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  colour text not null default 'blue' check (
    colour in ('blue', 'red', 'green', 'yellow', 'purple', 'orange', 'pink', 'teal')
  ),
  notes text,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create index if not exists teams_event_id_idx on public.teams (event_id);

-- ─── Event registrations ────────────────────────────────────────────────────

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status text not null default 'registered' check (
    status in (
      'registered', 'waitlisted', 'confirmed', 'checked_in',
      'attended', 'no_show', 'cancelled', 'refunded'
    )
  ),
  team_id uuid references public.teams(id) on delete set null,
  position_in_triangle int check (position_in_triangle between 1 and 3),
  registered_at timestamptz not null default now(),
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  cancelled_at timestamptz,
  payment_status text not null default 'free' check (
    payment_status in ('free', 'pending', 'paid', 'comp', 'refunded', 'failed')
  ),
  payment_pence int not null default 0,
  channel text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, participant_id)
);

create index if not exists registrations_event_id_idx on public.event_registrations (event_id);
create index if not exists registrations_participant_id_idx on public.event_registrations (participant_id);
create index if not exists registrations_status_idx on public.event_registrations (status);

-- ─── Feedback ───────────────────────────────────────────────────────────────

create table if not exists public.event_feedback (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  nps_score int check (nps_score between 0 and 10),
  rating int check (rating between 1 and 5),
  would_return boolean,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_event_id_idx on public.event_feedback (event_id);

-- ─── Communications log ────────────────────────────────────────────────────

create table if not exists public.comms_log (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.participants(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  channel text not null check (channel in ('email', 'sms', 'push', 'whatsapp', 'in_app')),
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  subject text,
  body_snippet text,
  status text not null default 'queued' check (
    status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'bounced', 'unsubscribed')
  ),
  template_key text,
  sent_at timestamptz,
  sent_by_admin_email text,
  external_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists comms_log_participant_id_idx on public.comms_log (participant_id);
create index if not exists comms_log_event_id_idx on public.comms_log (event_id);
create index if not exists comms_log_status_idx on public.comms_log (status);
create index if not exists comms_log_created_at_idx on public.comms_log (created_at desc);

-- ─── Audit log ──────────────────────────────────────────────────────────────

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_entity_idx on public.admin_audit_log (entity_type, entity_id);

-- ─── Convenience view: event roster snapshot ────────────────────────────────

create or replace view public.event_roster as
  select
    r.id                       as registration_id,
    r.event_id,
    e.name                     as event_name,
    e.starts_at                as event_starts_at,
    e.status                   as event_status,
    r.participant_id,
    p.full_name                as participant_name,
    p.email                    as participant_email,
    p.segment                  as participant_segment,
    p.city                     as participant_city,
    p.cohort                   as participant_cohort,
    r.status                   as registration_status,
    r.team_id,
    t.name                     as team_name,
    t.colour                   as team_colour,
    r.position_in_triangle,
    r.payment_status,
    r.payment_pence,
    r.registered_at,
    r.checked_in_at
  from public.event_registrations r
    join public.events e on e.id = r.event_id
    join public.participants p on p.id = r.participant_id
    left join public.teams t on t.id = r.team_id;

-- ─── Convenience view: event KPIs ───────────────────────────────────────────

create or replace view public.event_kpis as
  select
    e.id                                       as event_id,
    e.name,
    e.status,
    e.cohort,
    e.city,
    e.starts_at,
    e.ends_at,
    e.capacity,
    e.waitlist_capacity,
    coalesce(count(*) filter (
      where r.status in ('registered', 'confirmed', 'checked_in', 'attended')
    ), 0)::int as registered_count,
    coalesce(count(*) filter (where r.status = 'waitlisted'), 0)::int as waitlisted_count,
    coalesce(count(*) filter (where r.status = 'attended'), 0)::int as attended_count,
    coalesce(count(*) filter (where r.status = 'no_show'), 0)::int as no_show_count,
    coalesce(count(*) filter (where r.status = 'cancelled'), 0)::int as cancelled_count,
    coalesce(sum(r.payment_pence) filter (where r.payment_status = 'paid'), 0)::int as revenue_pence,
    case
      when e.capacity = 0 then 0
      else round(
        100.0 * coalesce(count(*) filter (
          where r.status in ('registered', 'confirmed', 'checked_in', 'attended')
        ), 0) / e.capacity
      )::int
    end as capacity_pct
  from public.events e
    left join public.event_registrations r on r.event_id = e.id
  group by e.id;

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.admin_users         enable row level security;
alter table public.venues              enable row level security;
alter table public.events              enable row level security;
alter table public.participants        enable row level security;
alter table public.teams               enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_feedback      enable row level security;
alter table public.comms_log           enable row level security;
alter table public.admin_audit_log     enable row level security;

-- Single admin-only policy per table. service_role bypasses RLS automatically.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'admin_users', 'venues', 'events', 'participants', 'teams',
    'event_registrations', 'event_feedback', 'comms_log', 'admin_audit_log'
  ] loop
    execute format('drop policy if exists "%s_admin_all" on public.%I', tbl, tbl);
    execute format(
      'create policy "%s_admin_all" on public.%I for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user())',
      tbl, tbl
    );
  end loop;
end $$;

-- Grants — authenticated role sees everything via RLS, anon nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.admin_users,
  public.venues,
  public.events,
  public.participants,
  public.teams,
  public.event_registrations,
  public.event_feedback,
  public.comms_log,
  public.admin_audit_log
to authenticated;

grant select on public.event_roster, public.event_kpis to authenticated;

grant all on
  public.admin_users,
  public.venues,
  public.events,
  public.participants,
  public.teams,
  public.event_registrations,
  public.event_feedback,
  public.comms_log,
  public.admin_audit_log
to service_role;

grant select on public.event_roster, public.event_kpis to service_role;

-- ─── updated_at triggers ────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['venues', 'events', 'participants', 'event_registrations'] loop
    execute format('drop trigger if exists %s_set_updated_at on public.%I', tbl, tbl);
    execute format(
      'create trigger %s_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      tbl, tbl
    );
  end loop;
end $$;
