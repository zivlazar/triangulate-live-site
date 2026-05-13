-- Add optional phone_number column to waitlist signups.
--
-- The waitlist form gains a non-mandatory phone field. Captured for the
-- subset of signups who want SMS notification when sessions go live in
-- their city. Stays nullable so existing rows keep working and the form
-- can submit without it. No length constraint at DB level — the edge
-- function clamps to 40 chars to match the contact form's convention.

alter table public.waitlist
  add column if not exists phone_number text;
