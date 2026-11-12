-- =====================================================================
-- SafeHer — 0005_harden.sql
--
-- Fixes found by the Supabase database linter after the first deploy.
-- The first one is a real vulnerability, not a style note.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. request_cross_dispatch() had NO authorisation check.
--
-- It is SECURITY DEFINER, so RLS does not apply inside it. That meant
-- any signed-in account — a citizen, a guardian, anyone — could re-route
-- any incident to a different station or hospital just by knowing its
-- UUID. Cross-dispatch is a responder action; it now says so.
-- ---------------------------------------------------------------------

create or replace function request_cross_dispatch(p_incident_id uuid, p_want text)
returns incidents
language plpgsql security definer set search_path = public as $$
declare
  v_incident incidents%rowtype;
  v_row      jsonb;
begin
  -- Only a responder, and only one already entitled to this incident.
  if not exists (select 1 from responders r where r.id = auth.uid()) then
    raise exception 'request_cross_dispatch: responder role required';
  end if;
  if not can_see_incident(p_incident_id) then
    raise exception 'request_cross_dispatch: incident is not assigned to you';
  end if;

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
               then 'Police support requested - ' || coalesce(v_row->>'name','(none in range)')
               else 'Ambulance support requested - ' || coalesce(v_row->>'name','(none in range)') end,
          jsonb_build_object('cross_dispatch', p_want, 'target', v_row));

  return v_incident;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. Pin search_path on every remaining function.
--
-- A function without a fixed search_path can be hijacked by a caller who
-- puts a malicious table earlier on their path. It matters most for
-- SECURITY DEFINER functions, but pinning all of them costs nothing.
-- ---------------------------------------------------------------------

alter function forbid_mutation()                  set search_path = public;
alter function incident_stamp_times()             set search_path = public;
alter function incident_is_live(text)             set search_path = public;
alter function nearest_stations(double precision, double precision, int)  set search_path = public;
alter function nearest_hospitals(double precision, double precision, int) set search_path = public;
alter function nearest_units(double precision, double precision, text, int) set search_path = public;


-- ---------------------------------------------------------------------
-- 3. Stop exposing internals over the REST API.
--
-- Every function in `public` is published at /rest/v1/rpc/<name>. The
-- RLS helpers are implementation detail: policies call them internally,
-- so `authenticated` still needs EXECUTE, but nobody should be able to
-- invoke them directly — and `anon` should not reach them at all.
-- ---------------------------------------------------------------------

-- Trigger functions: nothing should call these directly, ever.
revoke all on function forbid_mutation()      from public, anon, authenticated;
revoke all on function incident_stamp_times() from public, anon, authenticated;
revoke all on function incident_status_event() from public, anon, authenticated;

-- RLS helpers: needed by policy evaluation for signed-in users only.
do $$
declare fn text;
begin
  foreach fn in array array[
    'my_role()',
    'my_station_id()',
    'my_hospital_id()',
    'is_supervisor()',
    'is_police()',
    'is_medic()',
    'guards_user(uuid)',
    'can_see_incident(uuid)',
    'incident_is_live(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- Callable RPCs: signed-in users only. Each one enforces its own rules
-- internally as well — raise_sos requires a session, reassign_station
-- requires a supervisor, request_cross_dispatch requires a responder.
revoke all on function raise_sos(text,text,double precision,double precision,int,boolean,text,boolean) from public, anon;
grant execute on function raise_sos(text,text,double precision,double precision,int,boolean,text,boolean) to authenticated;

revoke all on function reassign_station(uuid,uuid,text) from public, anon;
grant execute on function reassign_station(uuid,uuid,text) to authenticated;

revoke all on function request_cross_dispatch(uuid,text) from public, anon;
grant execute on function request_cross_dispatch(uuid,text) to authenticated;

revoke all on function journey_checkin(uuid) from public, anon;
grant execute on function journey_checkin(uuid) to authenticated;

revoke all on function nearest_stations(double precision,double precision,int)  from public, anon;
revoke all on function nearest_hospitals(double precision,double precision,int) from public, anon;
revoke all on function nearest_units(double precision,double precision,text,int) from public, anon;
grant execute on function nearest_stations(double precision,double precision,int)  to authenticated;
grant execute on function nearest_hospitals(double precision,double precision,int) to authenticated;
grant execute on function nearest_units(double precision,double precision,text,int) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Known and accepted, documented rather than silently ignored:
--
--  * public.spatial_ref_sys has no RLS. It is a PostGIS system table of
--    coordinate-system definitions, owned by the extension, and cannot
--    have RLS enabled without superuser. It contains no user data.
--
--  * postgis lives in `public`. The generated `geom` columns in
--    0001_schema.sql resolve its types from there; relocating it would
--    require rebuilding those columns for no security gain here.
--
--  * ward_profiles and guardian_incident_history are intentionally
--    SECURITY DEFINER. That is the entire mechanism by which a guardian
--    is given identity-only access without a policy on `profiles` that
--    would expose medical columns permanently. Each view carries its own
--    guards_user() predicate. See the note in 0003_rls.sql.
-- ---------------------------------------------------------------------
