-- Waitlist — UK pre-launch waitlist for triangulate.live
--
-- Captures email + first name + city + age confirmation from /waitlist.
-- Used by the `waitlist-signup` edge function (anon-callable) which
-- inserts here via the service-role key.
--
-- Privacy posture:
--   - anon may INSERT only (no SELECT — submissions are private)
--   - service_role has full access (used by the edge function + any
--     admin tooling that needs to export the list)
--   - email is unique-cased lower; the function lowercases before insert

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  city text,
  age_confirmed boolean not null default false,
  analytics_consent boolean not null default false,
  consent_at timestamptz default now(),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  source_page text,
  referrer text,
  tracking_context jsonb not null default '{}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);
create index if not exists waitlist_city_idx on public.waitlist (city);
create index if not exists waitlist_utm_source_idx on public.waitlist (utm_source);

alter table public.waitlist enable row level security;

drop policy if exists "waitlist_anon_insert" on public.waitlist;
create policy "waitlist_anon_insert"
  on public.waitlist
  for insert
  to anon
  with check (
    age_confirmed = true
    and email is not null
    and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  );

-- Grants: anon needs INSERT (RLS policy will further restrict); SELECT is
-- intentionally NOT granted to anon for privacy. service_role gets all.
grant insert on public.waitlist to anon;
grant all on public.waitlist to service_role;
