-- =====================================================================
-- SafeHer — seed.sql  (§4)
-- Real coordinates: CHANDIGARH, India.
--
-- Stations are spread 1–8 km apart on purpose. Fire an SOS in Sector 17
-- and routing picks CHD-17; walk 3 km north and re-fire and it picks
-- CHD-14. If they were all clustered, the routing demo would prove
-- nothing.
--
-- To move the demo to another city, change only the lat/lng in the
-- police_stations, hospitals and units blocks below. Nothing else in the
-- codebase hardcodes a coordinate except DEMO_CENTER in
-- packages/shared/src/geo.ts.
--
-- All demo passwords: SafeHer@123
-- =====================================================================

-- ---------------------------------------------------------------------
-- A small helper so the account block below stays readable. Dropped at
-- the end of the file — it is a seeding convenience, not schema.
-- ---------------------------------------------------------------------
create or replace function seed_user(p_id uuid, p_email text, p_password text)
returns uuid language plpgsql as $$
begin
  -- The token columns below are nullable in Postgres but GoTrue scans them
  -- into non-nullable Go strings. Leaving them NULL makes every sign-in fail
  -- with the famously unhelpful "Database error querying schema", so they are
  -- seeded as empty strings on purpose. Do not remove them.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', '', '', '', '', ''
  ) on conflict (id) do nothing;

  -- GoTrue will not authenticate a user without a matching identity row.
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), p_id, p_id::text,
    json_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true)::jsonb,
    'email', now(), now(), now()
  ) on conflict do nothing;

  return p_id;
end;
$$;


-- =====================================================================
-- 1. POLICE STATIONS — 8, spread across the city grid
-- =====================================================================
insert into police_stations (id, name, code, district, state, lat, lng, control_room_phone, jurisdiction_radius_m) values
  ('11111111-0000-0000-0000-000000000017','Police Station Sector 17','CHD-17','Chandigarh','Chandigarh',30.74050,76.78200,'0172-2700017',3000),
  ('11111111-0000-0000-0000-000000000014','Police Station Sector 14','CHD-14','Chandigarh','Chandigarh',30.75760,76.76630,'0172-2700014',3000),
  ('11111111-0000-0000-0000-000000000034','Police Station Sector 34','CHD-34','Chandigarh','Chandigarh',30.71870,76.76880,'0172-2700034',3500),
  ('11111111-0000-0000-0000-000000000003','Police Headquarters Sector 3','CHD-03','Chandigarh','Chandigarh',30.75650,76.79130,'0172-2700003',4000),
  ('11111111-0000-0000-0000-000000000026','Police Station Sector 26','CHD-26','Chandigarh','Chandigarh',30.71900,76.80470,'0172-2700026',3500),
  ('11111111-0000-0000-0000-000000000039','Police Station Sector 39','CHD-39','Chandigarh','Chandigarh',30.70750,76.74970,'0172-2700039',4000),
  ('11111111-0000-0000-0000-000000000011','Police Station Sector 11','CHD-11','Chandigarh','Chandigarh',30.75190,76.77870,'0172-2700011',2500),
  ('11111111-0000-0000-0000-000000000088','Police Station Manimajra','CHD-MM','Chandigarh','Chandigarh',30.72830,76.83820,'0172-2700088',5000);


-- =====================================================================
-- 2. HOSPITALS — 5, two with trauma units
-- =====================================================================
insert into hospitals (id, name, type, lat, lng, has_ambulance, has_trauma_unit, beds_available) values
  ('22222222-0000-0000-0000-000000000012','PGIMER Sector 12','govt',   30.76480,76.77540,true,  true,  34),
  ('22222222-0000-0000-0000-000000000032','GMCH Sector 32','govt',     30.72690,76.76480,true,  true,  21),
  ('22222222-0000-0000-0000-000000000016','Govt Multi Specialty Hospital Sector 16','govt',30.74460,76.77900,true,false,12),
  ('22222222-0000-0000-0000-000000000034','Healing Hospital Sector 34','private',30.72050,76.76200,true,false,8),
  ('22222222-0000-0000-0000-000000000043','Fortis Hospital Mohali','private',30.70460,76.71790,true,false,17);


-- =====================================================================
-- 3. RESPONDER ACCOUNTS — 3 police + 2 medical
-- =====================================================================
select seed_user('33333333-0000-0000-0000-000000000001','dispatcher@safeher.demo','SafeHer@123');
select seed_user('33333333-0000-0000-0000-000000000002','officer@safeher.demo',   'SafeHer@123');
select seed_user('33333333-0000-0000-0000-000000000003','supervisor@safeher.demo','SafeHer@123');
select seed_user('33333333-0000-0000-0000-000000000004','medic@safeher.demo',     'SafeHer@123');
select seed_user('33333333-0000-0000-0000-000000000005','paramedic@safeher.demo', 'SafeHer@123');
-- Sector 16 is the nearest hospital to Sector 17 Plaza, which is where the
-- demo fires its medical SOS. Without a medic stationed there the alert
-- routes correctly and then sits in a control room nobody is signed into.
select seed_user('33333333-0000-0000-0000-000000000006','medic16@safeher.demo',   'SafeHer@123');

insert into responders (id, full_name, badge_no, role, station_id, hospital_id, on_duty) values
  ('33333333-0000-0000-0000-000000000001','ASI Kavita Rao',     'CHD-D-114','dispatcher','11111111-0000-0000-0000-000000000017',null,true),
  ('33333333-0000-0000-0000-000000000002','SI Ramesh Thakur',   'CHD-O-207','officer',   '11111111-0000-0000-0000-000000000014',null,true),
  ('33333333-0000-0000-0000-000000000003','DSP Anjali Mehra',   'CHD-S-009','supervisor','11111111-0000-0000-0000-000000000003',null,true),
  ('33333333-0000-0000-0000-000000000004','Dr. Sneha Iyer',     'PGI-M-441','medic',     null,'22222222-0000-0000-0000-000000000012',true),
  ('33333333-0000-0000-0000-000000000005','Paramedic Vikram Bedi','GMC-P-88','paramedic',null,'22222222-0000-0000-0000-000000000032',true),
  ('33333333-0000-0000-0000-000000000006','Dr. Arjun Malhotra',  'GMS-M-212','medic',    null,'22222222-0000-0000-0000-000000000016',true);


-- =====================================================================
-- 4. CITIZENS — fully populated medical records.
-- An empty record makes the entire pitch invisible, so these are filled
-- exactly as a real onboarding would fill them.
-- =====================================================================
select seed_user('44444444-0000-0000-0000-000000000001','priya@safeher.demo', 'SafeHer@123');
select seed_user('44444444-0000-0000-0000-000000000002','ananya@safeher.demo','SafeHer@123');

insert into profiles (id, full_name, phone, photo_url, date_of_birth, gender, address,
                      blood_group, allergies, conditions, medications, emergency_note, organ_donor) values
  ('44444444-0000-0000-0000-000000000001','Priya Sharma','+919876500001',null,'2001-04-17','female',
   'House 1142, Sector 15-B, Chandigarh 160015',
   'O-negative',
   array['Penicillin','Peanuts'],
   array['Asthma'],
   array['Salbutamol inhaler (as needed)'],
   'Severe asthmatic. Inhaler is in the front pocket of her bag. Penicillin causes anaphylaxis — do not administer.',
   true),

  ('44444444-0000-0000-0000-000000000002','Ananya Verma','+919876500002',null,'1998-11-02','female',
   'Flat 304, Sector 44-C, Chandigarh 160047',
   'B-positive',
   array['Sulfa drugs','Latex'],
   array['Type 1 Diabetes'],
   array['Insulin glargine 18u nightly','Insulin aspart with meals'],
   'Type 1 diabetic. If unconscious and glucose unavailable, treat as hypoglycaemia first. Latex-free gloves only.',
   false);


-- =====================================================================
-- 5. GUARDIAN — Priya's mother, installed and linked.
-- Plus one pending invite so the "link a ward" flow has something real
-- to claim during the demo.
-- =====================================================================
select seed_user('55555555-0000-0000-0000-000000000001','meera@safeher.demo','SafeHer@123');

insert into profiles (id, full_name, phone, gender, address) values
  ('55555555-0000-0000-0000-000000000001','Meera Sharma','+919876500011','female',
   'House 1142, Sector 15-B, Chandigarh 160015');

insert into guardians (id, user_id, linked_profile_id, name, phone, relation, tier, can_view_live, invite_code, status) values
  ('66666666-0000-0000-0000-000000000001',
   '44444444-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000001',
   'Meera Sharma','+919876500011','Mother',1,true,'SAFE-4821','active'),

  ('66666666-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000001',
   null,
   'Rajeev Sharma','+919876500012','Father',2,true,'SAFE-7390','pending'),

  ('66666666-0000-0000-0000-000000000003',
   '44444444-0000-0000-0000-000000000002',
   null,
   'Nisha Verma','+919876500013','Sister',1,true,'SAFE-2255','pending');


-- =====================================================================
-- 6. UNITS — 4 patrol + 2 ambulances, parked near their bases
-- =====================================================================
insert into units (id, callsign, kind, station_id, hospital_id, status, lat, lng) values
  ('77777777-0000-0000-0000-000000000001','PCR-17 Alpha','patrol',   '11111111-0000-0000-0000-000000000017',null,'available',30.74180,76.78050),
  ('77777777-0000-0000-0000-000000000002','PCR-14 Bravo','patrol',   '11111111-0000-0000-0000-000000000014',null,'available',30.75610,76.76810),
  ('77777777-0000-0000-0000-000000000003','PCR-34 Charlie','patrol', '11111111-0000-0000-0000-000000000034',null,'available',30.72010,76.77020),
  ('77777777-0000-0000-0000-000000000004','MBU-11 Delta','bike',     '11111111-0000-0000-0000-000000000011',null,'available',30.75240,76.77710),
  ('77777777-0000-0000-0000-000000000005','AMB-PGI-01','ambulance',  null,'22222222-0000-0000-0000-000000000012','available',30.76390,76.77620),
  ('77777777-0000-0000-0000-000000000006','AMB-GMCH-02','ambulance', null,'22222222-0000-0000-0000-000000000032','available',30.72740,76.76550);


drop function seed_user(uuid, text, text);
