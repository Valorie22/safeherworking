-- =====================================================================
-- SafeHer — 0001_schema.sql
-- The shared contract (§3.2). All four surfaces are built against these
-- exact table and column names. Do not rename anything here without
-- updating packages/shared/src/types.ts in the same commit.
-- =====================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------- people ----------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  phone text not null unique,
  photo_url text,
  date_of_birth date,
  gender text,
  address text,
  -- the medical record that travels with every SOS
  blood_group text,
  allergies text[],
  conditions text[],
  medications text[],
  emergency_note text,
  organ_donor boolean default false,
  created_at timestamptz default now()
);

-- ---------- the guardian graph ----------
create table guardians (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,  -- the protected person
  linked_profile_id uuid references profiles(id),                   -- set once the guardian installs Circle
  name text not null,
  phone text not null,
  relation text,
  tier int not null default 1 check (tier between 1 and 3),
  can_view_live boolean default true,
  invite_code text unique,
  status text default 'pending' check (status in ('pending','active','revoked')),
  created_at timestamptz default now()
);
create index on guardians (user_id);
create index on guardians (linked_profile_id);

-- ---------- responder infrastructure ----------
create table police_stations (
  id uuid primary key default gen_random_uuid(),
  name text not null, code text unique,
  district text, state text,
  lat double precision not null, lng double precision not null,
  geom geography(point,4326) generated always as
    (st_setsrid(st_makepoint(lng,lat),4326)::geography) stored,
  control_room_phone text, jurisdiction_radius_m int default 5000
);
create index on police_stations using gist (geom);

create table hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null, type text,             -- govt | private | trauma | clinic
  lat double precision not null, lng double precision not null,
  geom geography(point,4326) generated always as
    (st_setsrid(st_makepoint(lng,lat),4326)::geography) stored,
  has_ambulance boolean default true, has_trauma_unit boolean default false,
  beds_available int default 0
);
create index on hospitals using gist (geom);

create table responders (                     -- officers AND medics, one table, role-separated
  id uuid primary key references auth.users on delete cascade,
  full_name text not null, badge_no text,
  role text not null check (role in ('dispatcher','officer','supervisor','medic','paramedic')),
  station_id uuid references police_stations(id),
  hospital_id uuid references hospitals(id),
  on_duty boolean default false
);
create index on responders (station_id);
create index on responders (hospital_id);

create table units (                          -- patrol vehicles / ambulances
  id uuid primary key default gen_random_uuid(),
  callsign text not null,
  kind text check (kind in ('patrol','ambulance','bike')),
  station_id uuid references police_stations(id),
  hospital_id uuid references hospitals(id),
  status text default 'available' check (status in ('available','dispatched','enroute','onscene','offline')),
  lat double precision, lng double precision, updated_at timestamptz default now()
);

-- ---------- the incident ----------
create table incidents (
  id uuid primary key default gen_random_uuid(),
  public_ref text unique default ('SOS-' || upper(substr(md5(random()::text),1,6))),
  user_id uuid not null references profiles(id),
  type text not null check (type in ('safety','medical')),
  trigger_reason text not null,               -- manual | shake | duress | acoustic | journey | battery | medical_manual | fall
  severity text default 'high' check (severity in ('low','medium','high','critical')),
  status text not null default 'new'
    check (status in ('new','acknowledged','assigned','dispatched','enroute','onscene','resolved','false_alarm')),
  silent boolean default false,
  lat double precision, lng double precision, accuracy_m int,
  geom geography(point,4326),
  assigned_station_id uuid references police_stations(id),
  assigned_hospital_id uuid references hospitals(id),
  assigned_responder_id uuid references responders(id),
  assigned_unit_id uuid references units(id),
  routing_distance_m int,
  medical_snapshot jsonb,                     -- frozen copy of the medical record at trigger time
  created_at timestamptz default now(),
  acknowledged_at timestamptz, dispatched_at timestamptz, resolved_at timestamptz,
  resolution_note text
);
create index on incidents (status, created_at desc);
create index on incidents using gist (geom);
create index on incidents (assigned_station_id, created_at desc);
create index on incidents (assigned_hospital_id, created_at desc);
create index on incidents (user_id, created_at desc);

create table incident_locations (             -- the breadcrumb trail
  id bigserial primary key,
  incident_id uuid not null references incidents(id) on delete cascade,
  lat double precision not null, lng double precision not null,
  accuracy_m int, speed_mps real, captured_at timestamptz default now()
);
create index on incident_locations (incident_id, captured_at);

create table incident_media (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  kind text not null check (kind in ('audio','photo','video')),
  storage_path text not null,
  duration_ms int,
  captured_at timestamptz not null,
  before_trigger boolean default false,       -- TRUE = sealed from the rolling buffer
  uploaded_at timestamptz default now()
);
create index on incident_media (incident_id, captured_at);

create table incident_events (                -- append-only audit timeline
  id bigserial primary key,
  incident_id uuid not null references incidents(id) on delete cascade,
  actor_type text not null check (actor_type in ('system','citizen','guardian','responder')),
  actor_id uuid,
  kind text not null,                         -- see §3.4
  message text,
  payload jsonb,
  at timestamptz default now()
);
create index on incident_events (incident_id, at);

create table incident_messages (              -- in-ecosystem text comms
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  sender_role text not null check (sender_role in ('citizen','guardian','responder')),
  sender_id uuid,
  body text,
  audio_path text,                            -- push-to-talk clip
  at timestamptz default now()
);
create index on incident_messages (incident_id, at);

create table journeys (                       -- dead-man's switch
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  label text, destination text,
  eta_minutes int, interval_seconds int not null default 300,
  next_checkin_at timestamptz not null,
  state text default 'running' check (state in ('running','overdue','breached','completed')),
  started_at timestamptz default now(), ended_at timestamptz
);
create index on journeys (user_id, started_at desc);

-- ---------- append-only enforcement (rule 4) ----------
-- incident_events is an audit log. Nothing updates or deletes a row in it,
-- and the database, not the client, is what guarantees that.
create or replace function forbid_mutation() returns trigger
language plpgsql as $fn$
begin
  raise exception 'incident_events is append-only; % is not permitted', tg_op;
end;
$fn$;

create trigger incident_events_no_update before update on incident_events
  for each row execute function forbid_mutation();
create trigger incident_events_no_delete before delete on incident_events
  for each row execute function forbid_mutation();

-- ---------- realtime ----------
-- The live incident wall subscribes to postgres_changes on these tables.
alter publication supabase_realtime add table incidents;
alter publication supabase_realtime add table incident_events;
alter publication supabase_realtime add table incident_locations;
alter publication supabase_realtime add table incident_media;
alter publication supabase_realtime add table incident_messages;
alter publication supabase_realtime add table journeys;
alter publication supabase_realtime add table units;

-- Realtime needs the full old row to evaluate RLS predicates on UPDATE.
alter table incidents replica identity full;
alter table journeys replica identity full;
alter table units replica identity full;
