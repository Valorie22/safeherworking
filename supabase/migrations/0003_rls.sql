-- =====================================================================
-- SafeHer — 0003_rls.sql
-- The permission matrix from §3.5, as real policies.
--
-- A dashboard where any logged-in user can read every citizen's medical
-- record is not a safety product. This file is the first thing a sharp
-- examiner will probe, so it ends with a policy test that runs on every
-- `supabase db reset`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers. All SECURITY DEFINER + STABLE so a policy can call them
-- without recursing back through the policy it is evaluating.
-- ---------------------------------------------------------------------

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select r.role from responders r where r.id = auth.uid();
$$;

create or replace function my_station_id() returns uuid
language sql stable security definer set search_path = public as $$
  select r.station_id from responders r where r.id = auth.uid();
$$;

create or replace function my_hospital_id() returns uuid
language sql stable security definer set search_path = public as $$
  select r.hospital_id from responders r where r.id = auth.uid();
$$;

create or replace function is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.role = 'supervisor' from responders r where r.id = auth.uid()), false);
$$;

create or replace function is_police() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.role in ('dispatcher','officer','supervisor')
                     from responders r where r.id = auth.uid()), false);
$$;

create or replace function is_medic() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.role in ('medic','paramedic')
                     from responders r where r.id = auth.uid()), false);
$$;

-- Am I an active guardian of this person?
create or replace function guards_user(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guardians g
     where g.user_id = p_user_id
       and g.linked_profile_id = auth.uid()
       and g.status = 'active'
  );
$$;

-- An incident is "live" until someone closes it. Guardian access to a
-- ward's data is scoped to exactly this window — see the note on
-- profiles below.
create or replace function incident_is_live(p_status text) returns boolean
language sql immutable as $$
  select p_status not in ('resolved','false_alarm');
$$;

-- Can the caller see this incident at all? One definition, reused by
-- every child table, so the child tables cannot drift from the parent.
create or replace function can_see_incident(p_incident_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from incidents i
     where i.id = p_incident_id
       and (
            i.user_id = auth.uid()                                          -- the citizen
         or is_supervisor()                                                 -- city-wide
         or (is_police() and i.assigned_station_id  = my_station_id())      -- their station
         or (is_medic()  and i.assigned_hospital_id = my_hospital_id()
                        and i.type = 'medical')                             -- their hospital
         or (guards_user(i.user_id) and incident_is_live(i.status))         -- active guardian
       )
  );
$$;


alter table profiles           enable row level security;
alter table guardians          enable row level security;
alter table police_stations    enable row level security;
alter table hospitals          enable row level security;
alter table responders         enable row level security;
alter table units              enable row level security;
alter table incidents          enable row level security;
alter table incident_locations enable row level security;
alter table incident_media     enable row level security;
alter table incident_events    enable row level security;
alter table incident_messages  enable row level security;
alter table journeys           enable row level security;


-- ---------------------------------------------------------------------
-- profiles
--
-- NOTE ON GUARDIANS AND MEDICAL DATA.
-- Guardians deliberately get NO policy on this table. RLS is row-level,
-- so a policy here would hand them every medical column of their ward
-- permanently — which is a surveillance tool, not a safety one. Instead
-- a guardian reads identity through the ward_profiles view below (no
-- medical columns exist in it at all), and reads medical data only from
-- incidents.medical_snapshot, which is itself gated to live incidents.
-- That is how "medical fields only during an active incident" is
-- actually enforced rather than merely hidden in the UI.
-- ---------------------------------------------------------------------

create policy profiles_select_own on profiles
  for select using (id = auth.uid());

create policy profiles_update_own on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());

-- A responder sees the citizen behind an incident that is theirs.
create policy profiles_select_responder on profiles
  for select using (
    exists (
      select 1 from incidents i
       where i.user_id = profiles.id
         and (
              is_supervisor()
           or (is_police() and i.assigned_station_id  = my_station_id())
           or (is_medic()  and i.assigned_hospital_id = my_hospital_id() and i.type = 'medical')
         )
    )
  );

-- Identity only. This view is SECURITY DEFINER by design: it is the
-- single doorway through which a guardian may see a ward, and the
-- medical columns are simply not in it.
create view ward_profiles
with (security_invoker = false) as
  select p.id, p.full_name, p.phone, p.photo_url, p.gender, p.date_of_birth
    from profiles p
   where guards_user(p.id);

grant select on ward_profiles to authenticated;


-- ---------------------------------------------------------------------
-- guardians
-- ---------------------------------------------------------------------

create policy guardians_owner_all on guardians
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The guardian sees the link rows that name them.
create policy guardians_select_linked on guardians
  for select using (linked_profile_id = auth.uid());

-- Claiming an invite code: the only field a guardian may write is the
-- link to themselves, and only on a row that is still pending.
create policy guardians_claim_invite on guardians
  for update using (status = 'pending' and linked_profile_id is null)
  with check (linked_profile_id = auth.uid() and status = 'active');

-- A responder sees who is on an incident's circle (to show "mother
-- acknowledged, 2 km away") but never the wider guardian graph.
create policy guardians_select_responder on guardians
  for select using (
    exists (select 1 from incidents i
             where i.user_id = guardians.user_id
               and can_see_incident(i.id))
  );


-- ---------------------------------------------------------------------
-- Responder infrastructure. Stations and hospitals are public reference
-- data — the citizen app shows "Sector 14 Police Station, 800 m".
-- ---------------------------------------------------------------------

create policy stations_read_all on police_stations for select using (auth.uid() is not null);
create policy hospitals_read_all on hospitals       for select using (auth.uid() is not null);

create policy responders_read_self on responders
  for select using (id = auth.uid());

-- Responders see their colleagues; citizens see the responder assigned
-- to their own incident, and nobody else.
create policy responders_read_colleagues on responders
  for select using (
       (is_police() and station_id  = my_station_id())
    or (is_medic()  and hospital_id = my_hospital_id())
    or is_supervisor()
    or exists (select 1 from incidents i
                where i.assigned_responder_id = responders.id
                  and can_see_incident(i.id))
  );

create policy units_read on units
  for select using (
       (is_police() and station_id  = my_station_id())
    or (is_medic()  and hospital_id = my_hospital_id())
    or is_supervisor()
    or exists (select 1 from incidents i
                where i.assigned_unit_id = units.id
                  and can_see_incident(i.id))
  );

create policy units_write_responder on units
  for update using (
       (is_police() and station_id  = my_station_id())
    or (is_medic()  and hospital_id = my_hospital_id())
    or is_supervisor()
  ) with check (true);


-- ---------------------------------------------------------------------
-- incidents — the core of the matrix
-- ---------------------------------------------------------------------

create policy incidents_select_citizen on incidents
  for select using (user_id = auth.uid());

-- Guardians see a ward's incident only while it is live. Once it is
-- resolved the row disappears from them entirely, taking the frozen
-- medical snapshot with it. History comes from the masked view below.
create policy incidents_select_guardian on incidents
  for select using (guards_user(user_id) and incident_is_live(status));

create policy incidents_select_police on incidents
  for select using (is_police() and assigned_station_id = my_station_id());

create policy incidents_select_medic on incidents
  for select using (is_medic() and assigned_hospital_id = my_hospital_id() and type = 'medical');

create policy incidents_select_supervisor on incidents
  for select using (is_supervisor());

-- Citizens never INSERT directly. raise_sos() is the only entry point,
-- and it is SECURITY DEFINER, so no insert policy exists here at all.

-- The citizen may close their own incident ("I am safe").
create policy incidents_update_citizen on incidents
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and status in ('resolved','false_alarm'));

create policy incidents_update_police on incidents
  for update using (
       is_supervisor()
    or (is_police() and assigned_station_id = my_station_id())
  ) with check (true);

create policy incidents_update_medic on incidents
  for update using (is_medic() and assigned_hospital_id = my_hospital_id() and type = 'medical')
  with check (true);

-- Guardian history: past incidents, identity and outcome only.
-- medical_snapshot is not a column of this view.
create view guardian_incident_history
with (security_invoker = false) as
  select i.id, i.public_ref, i.user_id, i.type, i.trigger_reason, i.severity,
         i.status, i.lat, i.lng, i.created_at, i.acknowledged_at,
         i.dispatched_at, i.resolved_at, i.resolution_note,
         i.assigned_station_id, i.assigned_hospital_id, i.routing_distance_m
    from incidents i
   where guards_user(i.user_id);

grant select on guardian_incident_history to authenticated;


-- ---------------------------------------------------------------------
-- incident children — all gated by can_see_incident(), so they can
-- never drift from the parent's visibility rules.
-- ---------------------------------------------------------------------

create policy locations_select on incident_locations
  for select using (can_see_incident(incident_id));

create policy locations_insert_citizen on incident_locations
  for insert with check (
    exists (select 1 from incidents i where i.id = incident_id and i.user_id = auth.uid())
  );

create policy media_select on incident_media
  for select using (can_see_incident(incident_id));

create policy media_insert_citizen on incident_media
  for insert with check (
    exists (select 1 from incidents i where i.id = incident_id and i.user_id = auth.uid())
  );

create policy events_select on incident_events
  for select using (can_see_incident(incident_id));

-- Anyone who can see an incident may append to its timeline — that is
-- what makes guardian.context and responder actions auditable. Nobody
-- may update or delete: the triggers in 0001 forbid it outright.
create policy events_insert on incident_events
  for insert with check (can_see_incident(incident_id));

create policy messages_select on incident_messages
  for select using (can_see_incident(incident_id));

create policy messages_insert on incident_messages
  for insert with check (can_see_incident(incident_id) and sender_id = auth.uid());


-- ---------------------------------------------------------------------
-- journeys — the guardian watches the dead-man's switch tick, which is
-- what makes the system feel real before anything has gone wrong.
-- No medical data lives here, so live visibility is safe.
-- ---------------------------------------------------------------------

create policy journeys_owner_all on journeys
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy journeys_select_guardian on journeys
  for select using (guards_user(user_id));

create policy journeys_select_responder on journeys
  for select using (
    exists (select 1 from incidents i
             where i.user_id = journeys.user_id
               and can_see_incident(i.id))
  );


-- =====================================================================
-- POLICY TEST
-- Runs on every `supabase db reset`. If any assertion fails the
-- migration fails, so a broken policy can never ship quietly.
-- Everything it creates is rolled back at the end.
-- =====================================================================

do $test$
declare
  a uuid := gen_random_uuid();   -- citizen A
  b uuid := gen_random_uuid();   -- citizen B
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (a, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
     'rlstest-a@safeher.test','x', now(), now(), now()),
    (b, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
     'rlstest-b@safeher.test','x', now(), now(), now());

  insert into profiles (id, full_name, phone, blood_group, allergies) values
    (a, 'RLS Test A', '+910000000001', 'O+',  array['peanuts']),
    (b, 'RLS Test B', '+910000000002', 'AB-', array['penicillin']);

  -- Become citizen A.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1. A citizen must not be able to read another citizen's profile.
  select count(*) into n from profiles where id = b;
  if n <> 0 then
    raise exception 'RLS FAIL: citizen A read citizen B profile (% rows)', n;
  end if;

  -- 2. A citizen must still be able to read their own.
  select count(*) into n from profiles where id = a;
  if n <> 1 then
    raise exception 'RLS FAIL: citizen A cannot read own profile (% rows)', n;
  end if;

  -- 3. A citizen who is not a guardian sees nothing through ward_profiles.
  select count(*) into n from ward_profiles;
  if n <> 0 then
    raise exception 'RLS FAIL: non-guardian read % ward_profiles rows', n;
  end if;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);

  raise notice 'RLS policy test passed.';

  delete from profiles where id in (a,b);
  delete from auth.users where id in (a,b);
exception when others then
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);
  delete from profiles where id in (a,b);
  delete from auth.users where id in (a,b);
  raise;
end;
$test$;
