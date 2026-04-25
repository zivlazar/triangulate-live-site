-- Drop the unused event_approval_requests table.
--
-- The event approval flow lives entirely in the game Supabase project:
-- event-approval-notify signs an HMAC token, the static page
-- triangulate.live/approve-event posts it to event-approval-confirm in the
-- game project, which verifies the token and mutates the events table there.
-- This table in the live-site project was never populated.

drop table if exists public.event_approval_requests;
