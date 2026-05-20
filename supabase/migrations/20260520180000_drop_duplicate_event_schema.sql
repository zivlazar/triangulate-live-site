-- Drop the duplicate event-management schema previously seeded into the
-- live-site Supabase project.
--
-- Background:
-- The first version of /admin-events.html shipped with its own copies of
-- events, participants, event_registrations, teams, etc. inside the live-site
-- project. That created two sources of truth: the rules baked into the
-- triangulate-game Supabase project (status transitions, +4h attendance
-- window, daily cap, lead time, conflict guard, auto-reject/auto-cleanup
-- crons, RLS, admin RPCs) and a separate column-and-status world living
-- in the live-site project's tables.
--
-- The portal is now a thin client over the game project's data. Reads go
-- through PostgREST against game tables; writes go through a new
-- live-site edge function (`admin-game-bridge`) that proxies the game's
-- approve_event / reject_event / cancel_event / approve_all_pending_events
-- RPCs using a configured admin player_id.
--
-- This migration drops every artefact added by
-- 20260519140000_event_management_admin.sql and 20260519140001_seed.sql,
-- except the admin_users allowlist which still gates magic-link sign-in
-- on /admin-events.html.

drop view if exists public.event_kpis;
drop view if exists public.event_roster;

drop table if exists public.admin_audit_log;
drop table if exists public.comms_log;
drop table if exists public.event_feedback;
drop table if exists public.event_registrations;
drop table if exists public.teams;
drop table if exists public.events;
drop table if exists public.venues;
drop table if exists public.participants;

-- Helper function used only by the dropped policies — safe to remove.
drop function if exists public.set_updated_at();

-- admin_users + public.is_admin_user() are intentionally preserved.
-- The is_admin_user() helper still gates RLS on admin_users itself and
-- is referenced by the admin-game-bridge edge function for the live-site
-- authentication check.
