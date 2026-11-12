-- =====================================================================
-- SafeHer — 0002_functions.sql
-- Routing and the single SOS entry point (§3.3).
--
-- Routing is resolved SERVER-SIDE. No client calculates the nearest
-- station. The dashboard receives the decision already made and only
-- visualises it — which is what makes the decision auditable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nearest-neighbour lookups. Both use the GiST index via the <-> operator,
-- then report true geodesic distance with st_distance.
-- ---------------------------------------------------------------------

create or replace function nearest_stations(
  p_lat double precision,
  p_lng double precision,
  p_limit int default 3
)
returns table (id uuid, name text, code text, distance_m int, lat double precision, lng double precision)
language sql stable as $$
  select s.id, s.name, s.code,
         round(st_distance(s.geom, st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography))::int,
         s.lat, s.lng
  from police_stations s
  order by s.geom <-> st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography
  limit p_limit;
$$;

create or replace function nearest_hospitals(
  p_lat double precision,
  p_lng double precision,
  p_limit int default 3
)
returns table (id uuid, name text, type text, distance_m int, has_trauma_unit boolean, lat double precision, lng double precision)
language sql stable as $$
  select h.id, h.name, h.type,
         round(st_distance(h.geom, st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography))::int,
         h.has_trauma_unit, h.lat, h.lng
  from hospitals h
  order by h.geom <-> st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography
  limit p_limit;
$$;

-- Available units ordered by distance from the incident — this is what
-- fills the "Assign unit" dropdown, so the officer picks by proximity,
-- not by scrolling a list.
create or replace function nearest_units(
  p_lat double precision,
  p_lng double precision,
  p_kind text default null,
  p_limit int default 8
)
returns table (id uuid, callsign text, kind text, status text, distance_m int, lat double precision, lng double precision)
language sql stable as $$
  select u.id, u.callsign, u.kind, u.status,
         case when u.lat is null then null else
           round(st_distance(
             st_setsrid(st_makepoint(u.lng,u.lat),4326)::geography,
             st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography))::int
         end,
         u.lat, u.lng
  from units u
  where (p_kind is null or u.kind = p_kind)
    and u.status <> 'offline'
  order by st_setsrid(st_makepoint(u.lng,u.lat),4326)::geography
           <-> st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography
  limit p_limit;
$$;


-- ---------------------------------------------------------------------
-- raise_sos — THE SINGLE ENTRY POINT.
-- The citizen app calls this and nothing else to create an incident.
-- One transaction: insert, freeze the medical record, set geom, resolve
-- routing, write the audit events, return the complete row.
-- ---------------------------------------------------------------------

create or replace function raise_sos(
  p_type            text,
  p_trigger_reason  text,
  p_lat             double precision default null,
  p_lng             double precision default null,
  p_accuracy_m      int              default null,
  p_silent          boolean          default false,
  p_severity        text             default 'high',
  p_location_stale  boolean          default false
)
returns incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_profile    profiles%rowtype;
  v_incident   incidents%rowtype;
  v_snapshot   jsonb;
  v_geom       geography(point,4326);
  v_stations   jsonb := '[]'::jsonb;
  v_hospitals  jsonb := '[]'::jsonb;
  v_station_id uuid;
  v_hosp_id    uuid;
  v_distance   int;
begin
  if v_uid is null then
    raise exception 'raise_sos: no authenticated user';
  end if;

  if p_type not in ('safety','medical') then
    raise exception 'raise_sos: type must be safety or medical, got %', p_type;
  end if;

  select * into v_profile from profiles where id = v_uid;
  if not found then
    raise exception 'raise_sos: no profile for user % — finish onboarding first', v_uid;
  end if;

  -- 2. Freeze the medical record. If they edit their profile tomorrow, the
  --    incident still shows exactly what responders were told at the time.
  v_snapshot := jsonb_build_object(
    'frozen_at',       now(),
    'full_name',       v_profile.full_name,
    'phone',           v_profile.phone,
    'photo_url',       v_profile.photo_url,
    'date_of_birth',   v_profile.date_of_birth,
    'age',             case when v_profile.date_of_birth is null then null
                            else extract(year from age(v_profile.date_of_birth))::int end,
    'gender',          v_profile.gender,
    'address',         v_profile.address,
    'blood_group',     v_profile.blood_group,
    'allergies',       coalesce(to_jsonb(v_profile.allergies),   '[]'::jsonb),
    'conditions',      coalesce(to_jsonb(v_profile.conditions),  '[]'::jsonb),
    'medications',     coalesce(to_jsonb(v_profile.medications), '[]'::jsonb),
    'emergency_note',  v_profile.emergency_note,
    'organ_donor',     coalesce(v_profile.organ_donor, false)
  );

  -- 3. geom from lat/lng. Null-safe: no GPS fix must never block the alert.
  if p_lat is not null and p_lng is not null then
    v_geom := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  -- 1. Insert the incident.
  insert into incidents (
    user_id, type, trigger_reason, severity, silent,
    lat, lng, accuracy_m, geom, medical_snapshot
  ) values (
    v_uid, p_type, p_trigger_reason, coalesce(p_severity,'high'), coalesce(p_silent,false),
    p_lat, p_lng, p_accuracy_m, v_geom, v_snapshot
  )
  returning * into v_incident;

  -- 5a. The alert exists. Record that first, so the timeline shows the
  --     press even if routing later finds nothing.
  insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
  values (
    v_incident.id, 'citizen', v_uid, 'sos.created',
    upper(p_type) || ' SOS raised (' || p_trigger_reason || ')',
    jsonb_build_object(
      'type',            p_type,
      'trigger_reason',  p_trigger_reason,
      'severity',        v_incident.severity,
      'silent',          v_incident.silent,
      'lat',             p_lat,
      'lng',             p_lng,
      'accuracy_m',      p_accuracy_m,
      'location_stale',  coalesce(p_location_stale,false),
      'public_ref',      v_incident.public_ref
    )
  );

  insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
  values (
    v_incident.id, 'system', null, 'sos.medical_snapshot',
    'Medical record frozen at trigger time',
    v_snapshot
  );

  -- 4. Resolve routing server-side.
  if v_geom is not null then

    -- Safety incidents route to a station. Medical incidents get BOTH —
    -- a medical emergency may still need police, and a road accident
    -- always does.
    select coalesce(jsonb_agg(to_jsonb(s) order by s.distance_m), '[]'::jsonb)
      into v_stations
      from nearest_stations(p_lat, p_lng, 3) s;

    if p_type = 'medical' then
      select coalesce(jsonb_agg(to_jsonb(h) order by h.distance_m), '[]'::jsonb)
        into v_hospitals
        from nearest_hospitals(p_lat, p_lng, 3) h;
    end if;

    v_station_id := (v_stations -> 0 ->> 'id')::uuid;
    v_hosp_id    := (v_hospitals -> 0 ->> 'id')::uuid;

    -- routing_distance_m is the distance to the surface that owns the
    -- incident: the hospital for a medical call, the station otherwise.
    if p_type = 'medical' and v_hosp_id is not null then
      v_distance := (v_hospitals -> 0 ->> 'distance_m')::int;
    else
      v_distance := (v_stations -> 0 ->> 'distance_m')::int;
    end if;

    update incidents
       set assigned_station_id  = v_station_id,
           assigned_hospital_id = v_hosp_id,
           routing_distance_m   = v_distance
     where id = v_incident.id
    returning * into v_incident;

    -- 5b. Why this station. The runners-up travel with the decision so a
    --     supervisor can see what was rejected and reassign with cause.
    insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
    values (
      v_incident.id, 'system', null, 'routing.resolved',
      case
        when p_type = 'medical' and v_hospitals -> 0 is not null
          then 'Routed to ' || (v_hospitals -> 0 ->> 'name') || ' (' || v_distance || ' m)'
        when v_stations -> 0 is not null
          then 'Routed to ' || (v_stations -> 0 ->> 'name') || ' (' || v_distance || ' m)'
        else 'No responder infrastructure within range'
      end,
      jsonb_build_object(
        'stations',            v_stations,
        'hospitals',           v_hospitals,
        'chosen_station_id',   v_station_id,
        'chosen_hospital_id',  v_hosp_id,
        'routing_distance_m',  v_distance,
        'resolved_in_ms',      round(extract(epoch from (clock_timestamp() - v_incident.created_at)) * 1000)
      )
    );

  else
    -- Rule 7: degrade, never dead-end. No fix means no routing, but the
    -- alert still exists and the control room is told why.
    insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
    values (
      v_incident.id, 'system', null, 'routing.resolved',
      'No location fix — routing deferred, alert raised anyway',
      jsonb_build_object('stations','[]'::jsonb,'hospitals','[]'::jsonb,'reason','no_location_fix')
    );
  end if;

  -- 6. Return the whole row, not an id. The citizen app must be able to
  --    render "Ambulance from Civil Hospital, 1.4 km" within a second.
  return v_incident;
end;
$$;

revoke all on function raise_sos(text,text,double precision,double precision,int,boolean,text,boolean) from public;
grant execute on function raise_sos(text,text,double precision,double precision,int,boolean,text,boolean) to authenticated;


-- ---------------------------------------------------------------------
-- No silent mutations (§8 rules). Every status change on an incident
-- writes an audit row automatically. The dashboard cannot forget to,
-- and a direct SQL update cannot bypass it.
-- ---------------------------------------------------------------------

create or replace function incident_status_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_actor uuid := auth.uid();
  v_actor_type text;
begin
  select case when exists (select 1 from responders r where r.id = v_actor) then 'responder'
              when v_actor is null then 'system'
              else 'citizen' end
    into v_actor_type;

  if new.status is distinct from old.status then
    v_kind := case new.status
                when 'acknowledged' then 'sos.acknowledged'
                when 'resolved'     then 'sos.resolved'
                when 'false_alarm'  then 'sos.false_alarm'
                else 'sos.status'
              end;

    insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
    values (new.id, v_actor_type, v_actor, v_kind,
            old.status || ' -> ' || new.status,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'resolution_note', new.resolution_note));
  end if;

  if new.assigned_unit_id is distinct from old.assigned_unit_id and new.assigned_unit_id is not null then
    insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
    select new.id, v_actor_type, v_actor, 'sos.unit_dispatched',
           'Unit ' || u.callsign || ' assigned',
           jsonb_build_object('unit_id', u.id, 'callsign', u.callsign, 'kind', u.kind)
      from units u where u.id = new.assigned_unit_id;
  end if;

  if new.assigned_responder_id is distinct from old.assigned_responder_id and new.assigned_responder_id is not null then
    insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
    select new.id, v_actor_type, v_actor, 'sos.assigned',
           r.full_name || ' took the incident',
           jsonb_build_object('responder_id', r.id, 'full_name', r.full_name, 'badge_no', r.badge_no)
      from responders r where r.id = new.assigned_responder_id;
  end if;

  return new;
end;
$$;

create trigger incidents_status_audit
  after update on incidents
  for each row execute function incident_status_event();

-- Keep the lifecycle timestamps honest without asking the client to.
create or replace function incident_stamp_times() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'acknowledged' and new.acknowledged_at is null then
      new.acknowledged_at := now();
    elsif new.status = 'dispatched' and new.dispatched_at is null then
      new.dispatched_at := now();
    elsif new.status in ('resolved','false_alarm') and new.resolved_at is null then
      new.resolved_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger incidents_stamp_times
  before update on incidents
  for each row execute function incident_stamp_times();


-- ---------------------------------------------------------------------
-- Supervisor reassignment (§8 panel 4) — never a bare update, because
-- the reason is the point.
-- ---------------------------------------------------------------------

create or replace function reassign_station(
  p_incident_id uuid,
  p_station_id  uuid,
  p_reason      text
)
returns incidents
language plpgsql security definer set search_path = public as $$
declare
  v_incident incidents%rowtype;
  v_old uuid;
  v_dist int;
begin
  if not exists (select 1 from responders r
                  where r.id = auth.uid() and r.role = 'supervisor') then
    raise exception 'reassign_station: supervisor role required';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'reassign_station: a reason is required';
  end if;

  select assigned_station_id into v_old from incidents where id = p_incident_id;

  select round(st_distance(s.geom, i.geom))::int into v_dist
    from police_stations s, incidents i
   where s.id = p_station_id and i.id = p_incident_id;

  update incidents
     set assigned_station_id = p_station_id,
         routing_distance_m  = coalesce(v_dist, routing_distance_m)
   where id = p_incident_id
  returning * into v_incident;

  insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
  select v_incident.id, 'responder', auth.uid(), 'sos.assigned',
         'Reassigned to ' || s.name || ' — ' || p_reason,
         jsonb_build_object('from_station_id', v_old, 'to_station_id', p_station_id,
                            'reason', p_reason, 'distance_m', v_dist)
    from police_stations s where s.id = p_station_id;

  return v_incident;
end;
$$;


-- ---------------------------------------------------------------------
-- Cross-dispatch (§9). Both directions must work: a medical incident
-- can pull in police, a safety incident can pull in an ambulance.
-- A road accident needs both.
-- ---------------------------------------------------------------------

create or replace function request_cross_dispatch(
  p_incident_id uuid,
  p_want        text              -- 'police' | 'medical'
)
returns incidents
language plpgsql security definer set search_path = public as $$
declare
  v_incident incidents%rowtype;
  v_row      jsonb;
begin
  select * into v_incident from incidents where id = p_incident_id;
  if not found then
    raise exception 'request_cross_dispatch: no incident %', p_incident_id;
  end if;
  if v_incident.lat is null then
    raise exception 'request_cross_dispatch: incident has no location to route from';
  end if;

  if p_want = 'police' then
    select to_jsonb(s) into v_row from nearest_stations(v_incident.lat, v_incident.lng, 1) s;
    update incidents set assigned_station_id = (v_row->>'id')::uuid
     where id = p_incident_id returning * into v_incident;

  elsif p_want = 'medical' then
    select to_jsonb(h) into v_row from nearest_hospitals(v_incident.lat, v_incident.lng, 1) h;
    update incidents set assigned_hospital_id = (v_row->>'id')::uuid
     where id = p_incident_id returning * into v_incident;

  else
    raise exception 'request_cross_dispatch: want must be police or medical, got %', p_want;
  end if;

  insert into incident_events (incident_id, actor_type, actor_id, kind, message, payload)
  values (p_incident_id, 'responder', auth.uid(), 'sos.assigned',
          case when p_want = 'police'
               then 'Police support requested — ' || coalesce(v_row->>'name','(none in range)')
               else 'Ambulance support requested — ' || coalesce(v_row->>'name','(none in range)') end,
          jsonb_build_object('cross_dispatch', p_want, 'target', v_row));

  return v_incident;
end;
$$;


-- ---------------------------------------------------------------------
-- Journeys — the dead-man's switch. Check-ins and breaches are events on
-- user:{user_id} so the guardian app can watch the countdown live.
-- ---------------------------------------------------------------------

create or replace function journey_checkin(p_journey_id uuid)
returns journeys
language plpgsql security definer set search_path = public as $$
declare v_j journeys%rowtype;
begin
  update journeys
     set next_checkin_at = now() + (interval_seconds || ' seconds')::interval,
         state = 'running'
   where id = p_journey_id and user_id = auth.uid()
  returning * into v_j;

  if not found then
    raise exception 'journey_checkin: no journey % for this user', p_journey_id;
  end if;
  return v_j;
end;
$$;
