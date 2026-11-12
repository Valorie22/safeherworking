#!/usr/bin/env tsx
/**
 * SafeHer — the security test.
 *
 * §12 says to test RLS with SQL, not by clicking. This does it from the
 * outside, through the real API with real sessions, which is stronger:
 * it proves the boundary holds against the same client any attacker
 * would use, not just against a query run as a superuser.
 *
 *   npm run test:rls
 *
 * Every check states what it is defending against. A failure here means
 * a citizen's medical record is reachable by someone who should not have
 * it, so this exits non-zero and should gate any deploy.
 */

import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  mint: '\x1b[38;5;85m',
  red: '\x1b[38;5;203m',
  grey: '\x1b[38;5;246m',
  lilac: '\x1b[38;5;183m',
};

const PW = 'SafeHer@123';
const PRIYA = '44444444-0000-0000-0000-000000000001';
const ANANYA = '44444444-0000-0000-0000-000000000002';

let failures = 0;

function check(pass: boolean, label: string, detail = '') {
  console.log(
    pass
      ? `${C.mint}✓${C.reset} ${label}`
      : `${C.red}✗ ${label}${C.reset}${detail ? `\n    ${C.dim}${detail}${C.reset}` : ''}`,
  );
  if (!pass) failures++;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const sb = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return sb;
}

async function main() {
  if (!URL || !KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY. Fill in .env.');
    process.exit(1);
  }

  const rule = () => console.log(C.grey + '─'.repeat(66) + C.reset);
  console.log(`\n${C.bold}SafeHer — security boundary test${C.reset}`);
  rule();

  // ---------------------------------------------------------------
  // Citizen isolation
  // ---------------------------------------------------------------
  console.log(`${C.lilac}Citizen isolation${C.reset}`);
  const priya = await signIn('priya@safeher.demo');

  const { data: otherProfile } = await priya.from('profiles').select('*').eq('id', ANANYA);
  check(
    (otherProfile?.length ?? 0) === 0,
    'a citizen cannot read another citizen’s profile',
    `got ${otherProfile?.length} row(s)`,
  );

  const { data: ownProfile } = await priya.from('profiles').select('*').eq('id', PRIYA);
  check((ownProfile?.length ?? 0) === 1, 'a citizen can read their own profile');

  const { data: allProfiles } = await priya.from('profiles').select('id');
  check(
    (allProfiles?.length ?? 0) === 1,
    'an unfiltered profiles select returns only the caller',
    `got ${allProfiles?.length} row(s)`,
  );

  // ---------------------------------------------------------------
  // The citizen must not be able to forge an incident
  // ---------------------------------------------------------------
  console.log(`\n${C.lilac}Incident creation${C.reset}`);
  const { error: insertErr } = await priya.from('incidents').insert({
    user_id: PRIYA,
    type: 'safety',
    trigger_reason: 'manual',
  });
  check(
    insertErr !== null,
    'a direct INSERT into incidents is refused (raise_sos is the only door)',
    insertErr ? '' : 'the insert SUCCEEDED, which it must not',
  );

  // ---------------------------------------------------------------
  // The audit log is append-only
  // ---------------------------------------------------------------
  const { data: mine } = await priya
    .from('incidents')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1);
  const incidentId = mine?.[0]?.id;

  if (incidentId) {
    const { data: ev } = await priya
      .from('incident_events')
      .select('id')
      .eq('incident_id', incidentId)
      .limit(1);
    const eventId = ev?.[0]?.id;

    if (eventId) {
      const { data: before } = await priya
        .from('incident_events')
        .select('message')
        .eq('id', eventId)
        .single();

      // Append-only is defended twice, and the two layers fail
      // differently, so assert the OUTCOME rather than the error.
      //
      //  Layer 1 — RLS: there is no UPDATE or DELETE policy on
      //    incident_events, so a citizen's statement matches zero rows.
      //    PostgREST reports that as success with nothing changed, NOT
      //    as an error. Asserting on an error here would be asserting
      //    on the wrong thing.
      //  Layer 2 — trigger: forbid_mutation() raises an exception for
      //    any role that DOES match rows, including a superuser with a
      //    direct psql connection.
      await priya.from('incident_events').update({ message: 'TAMPERED' }).eq('id', eventId);
      const { data: afterUpdate } = await priya
        .from('incident_events')
        .select('message')
        .eq('id', eventId)
        .single();
      check(
        afterUpdate?.message === before?.message,
        'an UPDATE on incident_events changes nothing (append-only)',
        `message became "${afterUpdate?.message}"`,
      );

      await priya.from('incident_events').delete().eq('id', eventId);
      const { data: afterDelete } = await priya
        .from('incident_events')
        .select('id')
        .eq('id', eventId);
      check(
        (afterDelete?.length ?? 0) === 1,
        'a DELETE on incident_events removes nothing (append-only)',
        'the row disappeared',
      );
    }
  }

  // ---------------------------------------------------------------
  // Cross-dispatch is a responder action
  // ---------------------------------------------------------------
  console.log(`\n${C.lilac}Privileged RPCs${C.reset}`);
  if (incidentId) {
    const { error: xErr } = await priya.rpc('request_cross_dispatch', {
      p_incident_id: incidentId,
      p_want: 'medical',
    });
    check(
      xErr !== null,
      'a citizen cannot call request_cross_dispatch',
      xErr ? '' : 'the call SUCCEEDED — any user could re-route any incident',
    );
  }

  const { error: reErr } = await priya.rpc('reassign_station', {
    p_incident_id: incidentId ?? PRIYA,
    p_station_id: '11111111-0000-0000-0000-000000000017',
    p_reason: 'test',
  });
  check(reErr !== null, 'a citizen cannot call reassign_station (supervisor only)');

  // The RLS helpers stay callable by signed-in users, and must: policy
  // expressions are evaluated with the caller's own privileges, so
  // revoking EXECUTE from `authenticated` would break every policy that
  // calls them. What matters is that they only ever report on the
  // caller — a citizen asking for a station id gets their own, which is
  // null, never somebody else's.
  const { data: myStation } = await priya.rpc('my_station_id');
  check(myStation === null, 'my_station_id() returns null for a citizen, not a real station');

  const { data: myRole } = await priya.rpc('my_role');
  check(myRole === null, 'my_role() returns null for a citizen');

  const { data: isPolice } = await priya.rpc('is_police');
  check(isPolice === false, 'is_police() is false for a citizen');

  const { data: guardsOther } = await priya.rpc('guards_user', { p_user_id: ANANYA });
  check(guardsOther === false, 'guards_user() cannot be used to probe another user’s circle');

  // ---------------------------------------------------------------
  // Station scoping
  // ---------------------------------------------------------------
  console.log(`\n${C.lilac}Responder scoping${C.reset}`);
  const officer = await signIn('officer@safeher.demo'); // Sector 14
  const dispatcher = await signIn('dispatcher@safeher.demo'); // Sector 17

  const { data: officerSees } = await officer.from('incidents').select('assigned_station_id');
  const officerStations = new Set((officerSees ?? []).map((i) => i.assigned_station_id));
  check(
    officerStations.size <= 1 &&
      (officerStations.size === 0 ||
        officerStations.has('11111111-0000-0000-0000-000000000014')),
    'an officer sees only their own station’s incidents',
    `saw ${officerStations.size} distinct station(s)`,
  );

  const { data: dispatcherSees } = await dispatcher
    .from('incidents')
    .select('assigned_station_id');
  const dispatcherStations = new Set(
    (dispatcherSees ?? []).map((i) => i.assigned_station_id),
  );
  check(
    dispatcherStations.size <= 1,
    'a dispatcher sees only their own station’s incidents',
    `saw ${dispatcherStations.size} distinct station(s)`,
  );

  check(
    !(officerSees ?? []).some((i) =>
      (dispatcherSees ?? []).some((d) => d.assigned_station_id === i.assigned_station_id),
    ) ||
      officerSees?.length === 0 ||
      dispatcherSees?.length === 0,
    'two stations do not see each other’s incidents',
  );

  // A medic sees only medical incidents.
  const medic = await signIn('medic@safeher.demo');
  const { data: medicSees } = await medic.from('incidents').select('type');
  check(
    (medicSees ?? []).every((i) => i.type === 'medical'),
    'a medic sees only type=medical incidents',
    `saw types: ${[...new Set((medicSees ?? []).map((i) => i.type))].join(', ') || 'none'}`,
  );

  // ---------------------------------------------------------------
  // Guardian scoping — the subtle one
  // ---------------------------------------------------------------
  console.log(`\n${C.lilac}Guardian scoping${C.reset}`);
  const meera = await signIn('meera@safeher.demo');

  const { data: wardView } = await meera.from('ward_profiles').select('*');
  check(
    (wardView?.length ?? 0) === 1,
    'a guardian sees exactly their linked ward through ward_profiles',
    `got ${wardView?.length} row(s)`,
  );

  const wardRow = (wardView?.[0] ?? {}) as Record<string, unknown>;
  check(
    !('blood_group' in wardRow) &&
      !('allergies' in wardRow) &&
      !('medications' in wardRow) &&
      !('emergency_note' in wardRow),
    'ward_profiles exposes NO medical columns at all',
    `columns: ${Object.keys(wardRow).join(', ')}`,
  );

  const { data: guardianDirect } = await meera.from('profiles').select('*').eq('id', PRIYA);
  check(
    (guardianDirect?.length ?? 0) === 0,
    'a guardian cannot read the ward’s profiles row directly',
    `got ${guardianDirect?.length} row(s) — medical columns would be exposed`,
  );

  const { data: history } = await meera.from('guardian_incident_history').select('*').limit(1);
  const histRow = (history?.[0] ?? {}) as Record<string, unknown>;
  check(
    history === null || !('medical_snapshot' in histRow),
    'guardian_incident_history carries no medical_snapshot',
  );

  // Resolved incidents must vanish from the guardian entirely.
  const { data: guardianIncidents } = await meera.from('incidents').select('status');
  check(
    (guardianIncidents ?? []).every((i) => !['resolved', 'false_alarm'].includes(i.status)),
    'a guardian cannot see resolved incidents (medical snapshot goes with them)',
    `saw statuses: ${[...new Set((guardianIncidents ?? []).map((i) => i.status))].join(', ') || 'none'}`,
  );

  // ---------------------------------------------------------------
  // Anonymous access
  // ---------------------------------------------------------------
  console.log(`\n${C.lilac}Anonymous access${C.reset}`);
  const anon = createClient(URL, KEY, { auth: { persistSession: false } });

  const { data: anonProfiles } = await anon.from('profiles').select('*');
  check((anonProfiles?.length ?? 0) === 0, 'an anonymous client reads no profiles');

  const { data: anonIncidents } = await anon.from('incidents').select('*');
  check((anonIncidents?.length ?? 0) === 0, 'an anonymous client reads no incidents');

  const { error: anonSos } = await anon.rpc('raise_sos', {
    p_type: 'safety',
    p_trigger_reason: 'manual',
    p_lat: 30.74,
    p_lng: 76.78,
  });
  check(anonSos !== null, 'an anonymous client cannot call raise_sos');

  rule();
  console.log(
    failures === 0
      ? `${C.mint}${C.bold}All security checks passed.${C.reset}\n`
      : `${C.red}${C.bold}${failures} security check(s) FAILED.${C.reset}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`${C.red}${e?.message ?? e}${C.reset}`);
  process.exit(1);
});
