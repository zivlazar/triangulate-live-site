-- Event management admin — seed data
--
-- Fake but realistic data for the /admin-events.html mockup. All names,
-- emails, and addresses are fictional. Date math is anchored to current
-- timestamps so the timeline always looks alive (past completions,
-- this-week live sessions, future scheduled).
--
-- Idempotent: each section guards against re-inserts so this is safe to
-- re-run against an existing seed (but it does NOT delete/replace — use
-- a manual TRUNCATE if you need a fresh slate).

set client_min_messages = warning;

-- Skip entirely if there's already non-trivial event data; this protects
-- production data if the migration ever lands somewhere with real entries.
do $$
declare
  event_count int;
begin
  select count(*) into event_count from public.events;
  if event_count > 5 then
    raise notice 'Skipping seed — % events already present.', event_count;
    return;
  end if;

  -- ─── Venues ──────────────────────────────────────────────────────────────
  insert into public.venues (id, name, address_line, city, postcode, region, latitude, longitude, capacity, surface, notes, is_active)
  values
    ('11111111-0000-4000-8000-000000000001', 'Hampstead Heath — East Heath', 'East Heath Road', 'London', 'NW3 1TH', 'Greater London', 51.5610, -0.1640, 60, 'grass', 'Main meet at the bandstand. Toilets 200m north.', true),
    ('11111111-0000-4000-8000-000000000002', 'Victoria Park — Pavilion Lawn', 'Grove Road', 'London', 'E3 5TB', 'Greater London', 51.5363, -0.0397, 48, 'grass', 'Easy DLR access. Parking limited Saturdays.', true),
    ('11111111-0000-4000-8000-000000000003', 'Battersea Park — Sports Field', 'Albert Bridge Road', 'London', 'SW11 4NJ', 'Greater London', 51.4791, -0.1568, 36, 'grass', 'Floodlit in winter. Booked through Wandsworth.', true),
    ('11111111-0000-4000-8000-000000000004', 'Heaton Park — Boating Lake Lawn', 'Middleton Road', 'Manchester', 'M25 2SW', 'Greater North West', 53.5450, -2.2415, 42, 'grass', 'North Manchester. Free parking 9-5 weekends.', true),
    ('11111111-0000-4000-8000-000000000005', 'Meadows — West Pitches', 'Melville Drive', 'Edinburgh', 'EH9 1JX', 'Scotland', 55.9389, -3.1900, 36, 'grass', 'Adjacent to Bristo Square — uni crowd post-session.', true),
    ('11111111-0000-4000-8000-000000000006', 'Eastville Park — Lower Lawn', 'Park Avenue', 'Bristol', 'BS5 6XA', 'South West', 51.4750, -2.5510, 30, 'mixed', 'Bring a backup pitch — gets muddy mid-winter.', true),
    ('11111111-0000-4000-8000-000000000007', 'Hyde Park — Old Football Pitches', 'North Carriage Drive', 'London', 'W2 2UH', 'Greater London', 51.5074, -0.1657, 72, 'grass', 'Royal Parks permit required for >40 players. Highest visibility venue.', true),
    ('11111111-0000-4000-8000-000000000008', 'Roundhay Park — Soldiers'' Field', 'Princes Avenue', 'Leeds', 'LS8 2HH', 'Yorkshire', 53.8419, -1.5045, 36, 'grass', 'Soldiers'' Field — large open pitch.', true)
  on conflict (id) do nothing;

  -- ─── Participants ────────────────────────────────────────────────────────
  -- 240 fake personas, mixed UK cities + cohorts + segments.
  insert into public.participants (
    email, full_name, display_name, phone_number, city, postcode,
    segment, source, cohort, dob_year, consent_marketing, consent_photo,
    notes, total_events_attended, total_no_shows, lifetime_value_pence,
    first_seen_at, last_seen_at, mixpanel_distinct_id
  )
  select
    'p' || lpad(g.n::text, 3, '0') || '@triangulate-fake.test'                                  as email,
    (firstnames[1 + (g.n * 7) % array_length(firstnames, 1)] || ' ' ||
     surnames[1 + (g.n * 13) % array_length(surnames, 1)])                                     as full_name,
    firstnames[1 + (g.n * 7) % array_length(firstnames, 1)]                                    as display_name,
    '+447' || lpad(((g.n * 47) % 1000000000)::text, 9, '0')                                    as phone_number,
    cities[1 + (g.n * 3) % array_length(cities, 1)]                                            as city,
    postcodes[1 + (g.n * 3) % array_length(postcodes, 1)]                                      as postcode,
    case when g.n % 28 = 0 then 'coach'
         when g.n % 35 = 0 then 'parent'
         when g.n % 42 = 0 then 'partner'
         when g.n % 60 = 0 then 'press'
         when g.n % 70 = 0 then 'staff'
         else 'player' end                                                                     as segment,
    case (g.n % 6)
      when 0 then 'waitlist'
      when 1 then 'waitlist'
      when 2 then 'direct'
      when 3 then 'referral'
      when 4 then 'partner'
      else 'walk_in' end                                                                       as source,
    case when g.n % 5 = 0 then 'A' else 'B' end                                                as cohort,
    case when g.n % 5 = 0 then 2010 + (g.n % 5)
         else 1998 + (g.n % 12) end                                                            as dob_year,
    (g.n % 4) <> 0                                                                             as consent_marketing,
    (g.n % 3) <> 0                                                                             as consent_photo,
    case when g.n % 11 = 0 then 'Returning player — flagged for early-access invites.'
         when g.n % 17 = 0 then 'Mentioned bringing a club along.'
         else null end                                                                         as notes,
    0, 0, 0,
    now() - ((g.n % 80 + 5) || ' days')::interval                                              as first_seen_at,
    now() - ((g.n % 14) || ' days')::interval                                                  as last_seen_at,
    'mx-fake-' || lpad(g.n::text, 4, '0')                                                      as mixpanel_distinct_id
  from generate_series(1, 240) as g(n)
  cross join (
    select
      array[
        'Alfie','Amelia','Aarav','Beatrice','Caleb','Chloe','Daisy','Dylan',
        'Esme','Ezra','Freya','Finn','Gracie','Harry','Hannah','Isla',
        'Imogen','Jack','Jaspreet','Jasmin','Kieran','Lola','Luca','Maya',
        'Maddie','Niamh','Noah','Oscar','Olive','Priya','Poppy','Quinn',
        'Rohan','Rosie','Saoirse','Sam','Tariq','Tilly','Uma','Vihaan',
        'Willow','Xanthe','Yasmin','Zion','Aisha','Brodie','Cara','Dougie',
        'Elinor','Fearne'
      ] as firstnames,
      array[
        'Aitken','Bashir','Carmichael','Davies','Edomwonyi','Fitzgerald',
        'Greaves','Hamilton','Imam','Jefferies','Kowalski','Lebedev',
        'Macdonald','Nair','Okafor','Patel','Quigley','Robinson','Sahota',
        'Thompson','Underwood','Visser','Wainwright','Yamada','Zaheer',
        'Bellingham','Chowdhury','Devereux'
      ] as surnames,
      array[
        'London','London','London','Manchester','Edinburgh','Bristol',
        'Leeds','London','Birmingham','Glasgow','Cardiff','London',
        'Liverpool','Newcastle','Nottingham','Sheffield','London','Manchester'
      ] as cities,
      array[
        'NW3 1AB','E2 9XX','SW11 4LL','M14 5QX','EH9 2JD','BS5 6PP',
        'LS6 3HF','SE15 4HN','B5 7AA','G12 8QQ','CF24 3NU','N1 4HX',
        'L1 8JG','NE2 4HH','NG7 1GE','S10 2TG','EC1V 9BD','M4 5JF'
      ] as postcodes
  ) lookups
  on conflict (email) do nothing;

  -- ─── Events ──────────────────────────────────────────────────────────────
  -- Mix of past (completed), this-week (live/scheduled), and future events.
  insert into public.events (
    id, slug, name, description, event_type, status, cohort,
    starts_at, ends_at, doors_at, venue_id, city,
    capacity, waitlist_capacity, price_pence, age_min, age_max,
    weather_call, organiser_email, organiser_name, tags, notes
  ) values
  -- ── PAST (completed) ─────────────────────────────────────────────────────
  ('22222222-0000-4000-8000-000000000001','past-london-1','Hampstead Heath — Sunday Triangles',
   'Test session #1. North London debut, 3v3 round-robin over 90 minutes.',
   'session','completed','B',
   now() - interval '63 days' + interval '15 hours', now() - interval '63 days' + interval '17 hours', null,
   '11111111-0000-4000-8000-000000000001','London',
   24, 8, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['debut','north-london','round-robin'], 'First session of the campaign.'),
  ('22222222-0000-4000-8000-000000000002','past-london-2','Victoria Park — Friday Floodlit',
   'East London evening session under floodlights.',
   'session','completed','B',
   now() - interval '56 days' + interval '19 hours', now() - interval '56 days' + interval '21 hours', null,
   '11111111-0000-4000-8000-000000000002','London',
   24, 8, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['east-london','evening'], null),
  ('22222222-0000-4000-8000-000000000003','past-london-3','Battersea — Saturday Open Play',
   '36-cap session. First waitlist overflow recorded.',
   'session','completed','B',
   now() - interval '49 days' + interval '14 hours', now() - interval '49 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000003','London',
   36, 12, 0, 18, 30, 'monitor', 'info@triangulate.live', 'Triangulate Ops',
   array['south-london','popular'], 'First session to hit waitlist cap.'),
  ('22222222-0000-4000-8000-000000000004','past-manchester-1','Heaton Park — Manchester Launch',
   'First Triangulate session outside London. Partnered with UoM run club for distribution.',
   'session','completed','B',
   now() - interval '42 days' + interval '13 hours', now() - interval '42 days' + interval '15 hours', null,
   '11111111-0000-4000-8000-000000000004','Manchester',
   36, 12, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['manchester','launch','partnership'], 'UoM run club brought 9 players.'),
  ('22222222-0000-4000-8000-000000000005','past-edinburgh-1','The Meadows — Edinburgh Debut',
   'Scotland launch. Pre-festival warm-up session.',
   'session','completed','B',
   now() - interval '35 days' + interval '15 hours', now() - interval '35 days' + interval '17 hours', null,
   '11111111-0000-4000-8000-000000000005','Edinburgh',
   24, 8, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['edinburgh','debut','scotland'], null),
  ('22222222-0000-4000-8000-000000000006','past-london-tournament-1','London Spring Triangle Cup',
   'First tournament format. 8 teams, bracket play, 3 hours.',
   'tournament','completed','B',
   now() - interval '28 days' + interval '12 hours', now() - interval '28 days' + interval '15 hours', null,
   '11111111-0000-4000-8000-000000000007','London',
   48, 16, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['tournament','hyde-park','flagship'], 'First tournament — 8 teams, single-elim bracket.'),
  ('22222222-0000-4000-8000-000000000007','past-bristol-1','Eastville — Bristol Open Day',
   'West Country debut. Co-hosted with Bristol University Sport.',
   'open_day','completed','mixed',
   now() - interval '21 days' + interval '14 hours', now() - interval '21 days' + interval '17 hours', null,
   '11111111-0000-4000-8000-000000000006','Bristol',
   30, 10, 0, 16, 30, 'monitor', 'info@triangulate.live', 'Triangulate Ops',
   array['bristol','open-day','uni-partner'], 'Rain held off — borderline weather call.'),
  ('22222222-0000-4000-8000-000000000008','past-london-press-1','Press Demo — Hyde Park',
   'Press-only demo session. WIRED UK, The Drum, Eurogamer attending.',
   'press','completed','B',
   now() - interval '14 days' + interval '11 hours', now() - interval '14 days' + interval '13 hours', null,
   '11111111-0000-4000-8000-000000000007','London',
   18, 6, 0, 18, 60, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['press','demo','flagship'], 'Press-only. 9 journalists confirmed.'),
  ('22222222-0000-4000-8000-000000000009','past-leeds-1','Roundhay Park — Leeds Launch',
   'Yorkshire debut session.',
   'session','completed','B',
   now() - interval '10 days' + interval '14 hours', now() - interval '10 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000008','Leeds',
   30, 10, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['leeds','debut'], null),
  ('22222222-0000-4000-8000-00000000000A','past-london-4','Battersea — Mid-week Practice',
   'Second Battersea session. Tested 24-cap mid-week slot.',
   'session','completed','B',
   now() - interval '7 days' + interval '18 hours', now() - interval '7 days' + interval '20 hours', null,
   '11111111-0000-4000-8000-000000000003','London',
   24, 8, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['south-london','midweek'], null),
  ('22222222-0000-4000-8000-00000000000B','past-london-cancel-1','Victoria Park — Cancelled (rain)',
   'Cancelled 4 hours before doors. Heavy rain warning.',
   'session','cancelled','B',
   now() - interval '5 days' + interval '15 hours', now() - interval '5 days' + interval '17 hours', null,
   '11111111-0000-4000-8000-000000000002','London',
   24, 8, 0, 18, 30, 'cancel', 'info@triangulate.live', 'Triangulate Ops',
   array['cancelled','weather'], 'Cancelled due to weather. All registrants offered next-session priority.'),
  ('22222222-0000-4000-8000-00000000000C','past-london-training-1','Coach Training — Hampstead',
   'First coach training session. 6 returning players trained as session leads.',
   'training','completed','B',
   now() - interval '3 days' + interval '10 hours', now() - interval '3 days' + interval '13 hours', null,
   '11111111-0000-4000-8000-000000000001','London',
   12, 4, 0, 21, 40, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['training','coach','internal'], 'Coach training cohort 1 — 6 graduates.'),

  -- ── THIS WEEK (live / scheduled imminent) ───────────────────────────────
  ('22222222-0000-4000-8000-00000000000D','now-london-1','Hampstead Heath — Tonight',
   'Tonight''s session. Floodlit, 18-30 cohort.',
   'session','live','B',
   now() + interval '4 hours', now() + interval '6 hours', now() + interval '3 hours 30 minutes',
   '11111111-0000-4000-8000-000000000001','London',
   30, 10, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['live','north-london','tonight'], 'Live in 4h — check-ins should be flowing.'),
  ('22222222-0000-4000-8000-00000000000E','now-manchester-1','Heaton Park — Saturday',
   'Manchester returners session this Saturday.',
   'session','scheduled','B',
   now() + interval '2 days' + interval '14 hours', now() + interval '2 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000004','Manchester',
   36, 12, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['manchester','returners'], null),
  ('22222222-0000-4000-8000-00000000000F','now-london-2','Victoria Park — Sunday',
   'East London Sunday afternoon.',
   'session','scheduled','B',
   now() + interval '3 days' + interval '14 hours', now() + interval '3 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000002','London',
   30, 10, 0, 18, 30, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['east-london','sunday'], null),
  ('22222222-0000-4000-8000-000000000010','now-edinburgh-1','The Meadows — Returners',
   'Edinburgh returners + new signups.',
   'session','scheduled','B',
   now() + interval '5 days' + interval '15 hours', now() + interval '5 days' + interval '17 hours', null,
   '11111111-0000-4000-8000-000000000005','Edinburgh',
   30, 10, 0, 18, 30, 'monitor', 'info@triangulate.live', 'Triangulate Ops',
   array['edinburgh','returners'], 'Weather monitor — rain forecast 50%.'),
  ('22222222-0000-4000-8000-000000000011','now-london-press-2','Press Follow-up — Hyde Park',
   'Second press session. Channel 4 News + Time Out London.',
   'press','scheduled','B',
   now() + interval '6 days' + interval '12 hours', now() + interval '6 days' + interval '14 hours', null,
   '11111111-0000-4000-8000-000000000007','London',
   24, 8, 0, 18, 60, 'go', 'info@triangulate.live', 'Triangulate Ops',
   array['press','follow-up'], 'Press batch 2.'),

  -- ── FUTURE (scheduled) ──────────────────────────────────────────────────
  ('22222222-0000-4000-8000-000000000012','fut-london-1','Battersea — Sat Open',
   'Weekend session, 36-cap.',
   'session','scheduled','B',
   now() + interval '9 days' + interval '14 hours', now() + interval '9 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000003','London',
   36, 12, 0, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['south-london'], null),
  ('22222222-0000-4000-8000-000000000013','fut-london-tournament-1','Summer Triangle Cup',
   'Tournament #2. 12 teams, bracket play, prizes.',
   'tournament','scheduled','B',
   now() + interval '14 days' + interval '11 hours', now() + interval '14 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000007','London',
   72, 24, 1500, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['tournament','flagship','paid'], 'First paid event. £15/player.'),
  ('22222222-0000-4000-8000-000000000014','fut-manchester-1','Heaton Park — Tournament',
   'Manchester tournament — first paid event up north.',
   'tournament','scheduled','B',
   now() + interval '21 days' + interval '12 hours', now() + interval '21 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000004','Manchester',
   42, 14, 1000, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['manchester','tournament','paid'], null),
  ('22222222-0000-4000-8000-000000000015','fut-london-2','Hampstead — Weeknight',
   'Mid-week regular slot.',
   'session','scheduled','B',
   now() + interval '24 days' + interval '19 hours', now() + interval '24 days' + interval '21 hours', null,
   '11111111-0000-4000-8000-000000000001','London',
   30, 10, 0, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['north-london','weeknight'], null),
  ('22222222-0000-4000-8000-000000000016','fut-bristol-1','Eastville — Bristol Returners',
   'Bristol returners session.',
   'session','scheduled','B',
   now() + interval '28 days' + interval '14 hours', now() + interval '28 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000006','Bristol',
   30, 10, 0, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['bristol','returners'], null),
  ('22222222-0000-4000-8000-000000000017','fut-leeds-1','Roundhay — Leeds Returners',
   'Leeds returners + new signups.',
   'session','scheduled','B',
   now() + interval '32 days' + interval '14 hours', now() + interval '32 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000008','Leeds',
   30, 10, 0, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['leeds','returners'], null),
  ('22222222-0000-4000-8000-000000000018','fut-london-3','Hyde Park — Summer Showcase',
   'Big summer showcase event. Open to general public + press.',
   'open_day','scheduled','mixed',
   now() + interval '40 days' + interval '12 hours', now() + interval '40 days' + interval '17 hours', null,
   '11111111-0000-4000-8000-000000000007','London',
   72, 24, 0, 14, 60, null, 'info@triangulate.live', 'Triangulate Ops',
   array['flagship','showcase','open'], 'Cohort A launch event (with parent supervision).'),
  ('22222222-0000-4000-8000-000000000019','fut-london-4','Victoria Park — Cohort A Trial',
   'First cohort A trial. Parent-supervised, 13-17 only.',
   'session','scheduled','A',
   now() + interval '45 days' + interval '13 hours', now() + interval '45 days' + interval '15 hours', null,
   '11111111-0000-4000-8000-000000000002','London',
   24, 8, 0, 13, 17, null, 'info@triangulate.live', 'Triangulate Ops',
   array['cohort-a','trial','parent-supervised'], 'COMPLIANCE: parent-supervised only. Cohort A.'),
  ('22222222-0000-4000-8000-00000000001A','fut-edinburgh-2','Meadows — Festival Side',
   'Edinburgh Fringe-adjacent slot.',
   'session','scheduled','B',
   now() + interval '50 days' + interval '15 hours', now() + interval '50 days' + interval '17 hours', null,
   '11111111-0000-4000-8000-000000000005','Edinburgh',
   30, 10, 0, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['edinburgh','festival'], 'Festival-side slot — high foot-traffic visibility.'),
  ('22222222-0000-4000-8000-00000000001B','fut-london-5','Battersea — Tuesday',
   'Mid-week regular slot.',
   'session','scheduled','B',
   now() + interval '55 days' + interval '19 hours', now() + interval '55 days' + interval '21 hours', null,
   '11111111-0000-4000-8000-000000000003','London',
   24, 8, 0, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['south-london','tuesday'], null),
  ('22222222-0000-4000-8000-00000000001C','fut-london-tournament-2','Triangle Series Final',
   'Series final. Top 12 teams qualified from prior tournaments.',
   'tournament','scheduled','B',
   now() + interval '60 days' + interval '11 hours', now() + interval '60 days' + interval '17 hours', null,
   '11111111-0000-4000-8000-000000000007','London',
   72, 24, 2500, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['tournament','final','flagship','paid'], 'Series final — £25/player. Live-streamed.'),
  ('22222222-0000-4000-8000-00000000001D','fut-london-draft-1','Greenwich Park — Pending Permit',
   'Pending Royal Parks permit confirmation. Draft only.',
   'session','draft','B',
   now() + interval '70 days' + interval '15 hours', now() + interval '70 days' + interval '17 hours', null,
   null,'London',
   30, 10, 0, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['draft','permit-pending'], 'Permit pending — do not publish.'),
  ('22222222-0000-4000-8000-00000000001E','fut-london-postpone-1','Hampstead — Bank Holiday (postponed)',
   'Postponed from bank-holiday slot to following weekend.',
   'session','postponed','B',
   now() + interval '78 days' + interval '14 hours', now() + interval '78 days' + interval '16 hours', null,
   '11111111-0000-4000-8000-000000000001','London',
   30, 10, 0, 18, 30, null, 'info@triangulate.live', 'Triangulate Ops',
   array['postponed'], 'Postponed — bank holiday clash.')
  on conflict (id) do nothing;

  -- ─── Registrations ───────────────────────────────────────────────────────
  -- Past events: registered → attended/no_show mix.
  -- This-week events: registered → some checked_in (for live event).
  -- Future events: registered + waitlisted spread.
  insert into public.event_registrations (
    event_id, participant_id, status, registered_at, checked_in_at, payment_status, payment_pence, channel
  )
  select
    e.id,
    p.id,
    case
      when e.status = 'completed' and (p_row.rn % 11) = 0 then 'no_show'
      when e.status = 'completed' and (p_row.rn % 23) = 0 then 'cancelled'
      when e.status = 'completed' then 'attended'
      when e.status = 'live' and (p_row.rn % 3) = 0 then 'checked_in'
      when e.status = 'live' then 'registered'
      when e.status = 'cancelled' then 'cancelled'
      when e.status = 'postponed' then 'registered'
      when p_row.rn > e.capacity then 'waitlisted'
      else 'registered'
    end as status,
    e.starts_at - ((p_row.rn % 14 + 2) || ' days')::interval as registered_at,
    case
      when e.status = 'completed' and (p_row.rn % 11) <> 0 then e.starts_at - interval '15 minutes'
      when e.status = 'live' and (p_row.rn % 3) = 0 then now() - interval '30 minutes'
      else null
    end as checked_in_at,
    case when e.price_pence > 0 then 'paid' else 'free' end,
    e.price_pence,
    case (p_row.rn % 5)
      when 0 then 'waitlist-promotion'
      when 1 then 'website'
      when 2 then 'ig-dm'
      when 3 then 'partner-club'
      else 'direct'
    end
  from public.events e
  cross join lateral (
    -- Pick N participants per event, where N varies by event size + status.
    select
      pp.id,
      row_number() over () as rn
    from public.participants pp
    where pp.id::text > '00000000-0000-0000-0000-000000000000'
    order by md5(pp.id::text || e.id::text)
    limit case
      when e.status = 'completed' then least(e.capacity + (e.capacity / 6), 50)
      when e.status = 'live' then greatest(e.capacity - 6, 12)
      when e.status = 'cancelled' then e.capacity / 2
      when e.status = 'postponed' then e.capacity / 3
      when e.status = 'draft' then 0
      when e.status = 'scheduled' and e.starts_at < now() + interval '14 days' then least(e.capacity + (e.capacity / 8), 50)
      when e.status = 'scheduled' then e.capacity / 2
      else e.capacity / 3
    end
  ) p_row
  join public.participants p on p.id = p_row.id
  on conflict (event_id, participant_id) do nothing;

  -- ─── Teams (one team for every 3 participants on completed events) ─────
  insert into public.teams (event_id, name, colour, notes)
  select
    e.id,
    'Team ' || team_n,
    (array['blue','red','green','yellow','purple','orange','pink','teal'])[1 + ((team_n - 1) % 8)],
    null
  from public.events e
  cross join generate_series(1, greatest(1, (
    select count(*)::int / 3
    from public.event_registrations r
    where r.event_id = e.id and r.status in ('attended','checked_in','registered')
  ))) as team_n
  where e.status in ('completed', 'live')
  on conflict (event_id, name) do nothing;

  -- Assign players to teams (round-robin by hash, position 1-2-3)
  with attendees as (
    select
      r.id as reg_id,
      r.event_id,
      row_number() over (partition by r.event_id order by md5(r.id::text)) as rn
    from public.event_registrations r
    where r.status in ('attended','checked_in')
  ),
  event_teams as (
    select
      t.id as team_id,
      t.event_id,
      row_number() over (partition by t.event_id order by t.created_at, t.name) as tn,
      count(*) over (partition by t.event_id) as team_count
    from public.teams t
  )
  update public.event_registrations r
  set
    team_id = et.team_id,
    position_in_triangle = 1 + ((a.rn - 1) % 3)
  from attendees a
  join event_teams et on et.event_id = a.event_id
    and et.tn = 1 + ((a.rn - 1) / 3) % et.team_count
  where r.id = a.reg_id
    and r.team_id is null;

  -- ─── Feedback (random NPS + ratings for completed events) ────────────────
  insert into public.event_feedback (event_id, participant_id, nps_score, rating, would_return, comment, created_at)
  select
    r.event_id,
    r.participant_id,
    case
      when (abs(hashtext(r.id::text)) % 100) < 60 then 9 + (abs(hashtext(r.id::text)) % 2)
      when (abs(hashtext(r.id::text)) % 100) < 85 then 7 + (abs(hashtext(r.id::text)) % 2)
      else (abs(hashtext(r.id::text)) % 7)
    end as nps_score,
    case
      when (abs(hashtext(r.id::text)) % 100) < 70 then 5
      when (abs(hashtext(r.id::text)) % 100) < 90 then 4
      else 3
    end as rating,
    (abs(hashtext(r.id::text)) % 100) < 88 as would_return,
    case (abs(hashtext(r.id::text)) % 10)
      when 0 then 'Brilliant — the triangle constraint is way more fun than I expected.'
      when 1 then 'Good vibes, would bring friends next time.'
      when 2 then 'A bit confused on rules at first but caught on by round 2.'
      when 3 then 'Loved the format. Please run one south of the river.'
      when 4 then 'Solid 90 mins. Would prefer 60 mins mid-week.'
      when 5 then null
      when 6 then 'Coaches were super welcoming. 10/10.'
      when 7 then 'Bit cold but format saved it.'
      when 8 then 'My team won, biased review obviously.'
      else 'Already booked the next one.'
    end as comment,
    r.checked_in_at + interval '3 hours' as created_at
  from public.event_registrations r
  where r.status = 'attended'
    and (abs(hashtext(r.id::text)) % 5) = 0
  on conflict do nothing;

  -- ─── Comms log (reminders, confirmations, post-event thanks) ────────────
  -- Confirmation emails on registration
  insert into public.comms_log (
    participant_id, event_id, channel, direction, subject, body_snippet,
    status, template_key, sent_at, sent_by_admin_email, metadata
  )
  select
    r.participant_id,
    r.event_id,
    'email',
    'outbound',
    'You''re booked — ' || e.name,
    'Quick confirmation that we''ve got you down for ' || e.name || ' on ' ||
      to_char(e.starts_at, 'Dy DD Mon FMHH24:MIPM') || '. Triangulate is a 3v3 outdoor game...',
    case
      when (abs(hashtext(r.id::text)) % 100) < 90 then 'delivered'
      when (abs(hashtext(r.id::text)) % 100) < 96 then 'opened'
      else 'failed'
    end,
    'registration_confirmation',
    r.registered_at + interval '2 minutes',
    'info@triangulate.live',
    jsonb_build_object('provider', 'resend', 'pseudo', true)
  from public.event_registrations r
  join public.events e on e.id = r.event_id
  where (abs(hashtext(r.id::text)) % 7) = 0;

  -- T-24h reminders for past completed events
  insert into public.comms_log (
    participant_id, event_id, channel, direction, subject, body_snippet,
    status, template_key, sent_at, sent_by_admin_email, metadata
  )
  select
    r.participant_id,
    r.event_id,
    case when (abs(hashtext(r.id::text)) % 4) = 0 then 'sms' else 'email' end,
    'outbound',
    'Tomorrow — ' || e.name,
    'See you tomorrow at ' || coalesce(v.name, e.city) || '. Wear trainers, bring water...',
    'delivered',
    'reminder_24h',
    e.starts_at - interval '24 hours',
    'info@triangulate.live',
    '{"pseudo": true}'::jsonb
  from public.event_registrations r
  join public.events e on e.id = r.event_id
  left join public.venues v on v.id = e.venue_id
  where e.status = 'completed'
    and r.status in ('attended', 'no_show')
    and (abs(hashtext(r.id::text)) % 3) = 0;

  -- Post-event NPS prompts
  insert into public.comms_log (
    participant_id, event_id, channel, direction, subject, body_snippet,
    status, template_key, sent_at, sent_by_admin_email, metadata
  )
  select
    r.participant_id,
    r.event_id,
    'email',
    'outbound',
    'How was ' || e.name || '?',
    'Quick one — how likely are you to recommend Triangulate to a friend? Single-tap NPS link inside.',
    case
      when (abs(hashtext(r.id::text)) % 100) < 30 then 'clicked'
      when (abs(hashtext(r.id::text)) % 100) < 70 then 'opened'
      else 'delivered'
    end,
    'post_event_nps',
    r.checked_in_at + interval '3 hours',
    'info@triangulate.live',
    '{"pseudo": true}'::jsonb
  from public.event_registrations r
  join public.events e on e.id = r.event_id
  where e.status = 'completed'
    and r.status = 'attended'
    and (abs(hashtext(r.id::text)) % 4) = 0;

  -- ─── Update participants.total_events_attended counters ─────────────────
  update public.participants p set
    total_events_attended = sub.attended_count,
    total_no_shows = sub.no_show_count,
    lifetime_value_pence = coalesce(sub.lifetime_value_pence, 0)
  from (
    select
      r.participant_id,
      count(*) filter (where r.status = 'attended')::int as attended_count,
      count(*) filter (where r.status = 'no_show')::int as no_show_count,
      sum(r.payment_pence) filter (where r.payment_status = 'paid')::int as lifetime_value_pence
    from public.event_registrations r
    group by r.participant_id
  ) sub
  where p.id = sub.participant_id;

  -- ─── Audit log (some plausible recent admin actions) ─────────────────────
  insert into public.admin_audit_log (admin_email, action, entity_type, entity_id, payload, created_at)
  values
    ('info@triangulate.live', 'event.cancel', 'events',
      '22222222-0000-4000-8000-00000000000B'::uuid,
      jsonb_build_object('reason', 'rain', 'notified_count', 18),
      now() - interval '5 days' - interval '4 hours'),
    ('info@triangulate.live', 'event.create', 'events',
      '22222222-0000-4000-8000-000000000013'::uuid,
      jsonb_build_object('source', 'admin-ui'),
      now() - interval '10 days'),
    ('info@triangulate.live', 'bulk.csv_export', 'participants', null,
      jsonb_build_object('row_count', 240, 'filter', 'segment=player'),
      now() - interval '2 days'),
    ('info@triangulate.live', 'event.update', 'events',
      '22222222-0000-4000-8000-000000000018'::uuid,
      jsonb_build_object('changed', array['capacity','cohort']),
      now() - interval '1 day');

  raise notice 'Seed complete — events / participants / registrations populated.';
end $$;
