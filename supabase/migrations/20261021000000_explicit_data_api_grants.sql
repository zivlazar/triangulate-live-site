-- Explicit Data API privileges for database resets and new Supabase projects.
-- Browser roles remain denied by RLS; these tables are used only by Edge Functions.

grant select, insert, update on table public.website_feedback to service_role;
grant select, insert, update on table public.social_publish_settings to service_role;
