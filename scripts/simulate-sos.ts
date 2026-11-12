#!/usr/bin/env tsx
/**
 * SafeHer — SOS simulator.
 *
 * This is how all four apps get tested without anyone running around
 * outside, and it is the backup plan if a phone loses Wi-Fi at the demo
 * table. It signs in as a real seeded citizen and calls raise_sos()
 * exactly as the phone does — so it exercises RLS, routing, the frozen
 * medical snapshot and the realtime fan-out, not a shortcut around them.
 *
 *   npm run sim -- --at sector-17
 *   npm run sim -- --type medical --at sector-34 --reason chest_pain
 *   npm run sim -- --at sukhna-lake --walk 1.4 --duration 180
 *   npm run sim -- --verify            # assert the acceptance criteria
 *   npm run sim -- --list              # show the named spots
 *
 * Synthetic audio and snapshots are REAL files (valid WAV and PNG), so
 * the dashboard's live feed actually plays and renders something —
 * including clips sealed from before the press.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import zlib from 'node:zlib';
import readline from 'node:readline';
import {
  DEMO_SPOTS,
  formatDistance,
  offsetMetres,
  mediaPath,
  type Incident,
  type NearestStation,
  type NearestHospital,
  type RoutingResolvedPayload,
} from '../packages/shared/src/index';

// ---------------------------------------------------------------------
// Terminal styling — the SafeHer palette, approximated in 256 colours.
// ---------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  rose: '\x1b[38;5;205m',
  amber: '\x1b[38;5;214m',
  lilac: '\x1b[38;5;183m',
  mint: '\x1b[38;5;85m',
  sky: '\x1b[38;5;117m',
  grey: '\x1b[38;5;246m',
  red: '\x1b[38;5;203m',
};
const rule = (ch = '─') => C.grey + ch.repeat(64) + C.reset;
const ok = (s: string) => `${C.mint}✓${C.reset} ${s}`;
const bad = (s: string) => `${C.red}✗${C.reset} ${s}`;

// ---------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------
interface Args {
  type: 'safety' | 'medical';
  at: string;
  as: string;
  password: string;
  reason?: string;
  walk: number; // metres per second; 1.4 is a brisk walk
  interval: number; // seconds between breadcrumbs
  duration: number; // seconds to keep streaming; 0 = until Ctrl-C
  silent: boolean;
  noMedia: boolean;
  verify: boolean;
  list: boolean;
  resolveOnExit: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  return {
    type: (get('type', 'safety') as Args['type']),
    at: get('at', 'sector-17')!,
    as: get('as', 'priya@safeher.demo')!,
    password: get('password', 'SafeHer@123')!,
    reason: get('reason'),
    walk: Number(get('walk', '1.3')),
    interval: Number(get('interval', '3')),
    duration: Number(get('duration', '0')),
    silent: has('silent'),
    noMedia: has('no-media'),
    verify: has('verify'),
    list: has('list'),
    resolveOnExit: has('resolve-on-exit'),
  };
}

function resolveSpot(at: string): { lat: number; lng: number; label: string } {
  if (DEMO_SPOTS[at]) return DEMO_SPOTS[at];
  const m = at.split(',').map((s) => Number(s.trim()));
  if (m.length === 2 && m.every((n) => Number.isFinite(n))) {
    return { lat: m[0], lng: m[1], label: `${m[0].toFixed(5)}, ${m[1].toFixed(5)}` };
  }
  throw new Error(
    `Unknown spot "${at}". Use --list to see the named spots, or pass "lat,lng".`,
  );
}

// ---------------------------------------------------------------------
// Synthetic media. Real files, so the dashboard has something to play.
// ---------------------------------------------------------------------

/** A valid 16-bit mono WAV containing a tone — audible, and distinguishable per clip. */
function makeWav(seconds: number, hz: number): Buffer {
  const rate = 16000;
  const n = Math.floor(rate * seconds);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    // Fade in/out so it does not click, and wobble the pitch a little so
    // consecutive clips are obviously different when played back-to-back.
    const t = i / rate;
    const env = Math.min(1, t * 4, (seconds - t) * 4);
    const v = Math.sin(2 * Math.PI * (hz + Math.sin(t * 2) * 15) * t) * 0.25 * env;
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A real PNG "snapshot". Each frame gets a different hue and a bright
 * moving band, so the snapshot strip in the dashboard visibly advances
 * rather than showing the same grey square eight times.
 */
function makePng(width: number, height: number, frame: number): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let p = 0;
  const band = (frame * 13) % height;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const near = Math.abs(y - band) < 6;
      // Deep aubergine base, rose highlight — the SafeHer palette.
      raw[p++] = near ? 255 : 30 + ((x + frame * 5) % 40);
      raw[p++] = near ? 77 : 10 + ((y * 2) % 25);
      raw[p++] = near ? 141 : 40 + ((x * 3 + y) % 55);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log(`\n${C.bold}Named demo spots${C.reset} ${C.dim}(--at <name>)${C.reset}\n`);
    for (const [k, v] of Object.entries(DEMO_SPOTS)) {
      console.log(`  ${C.rose}${k.padEnd(14)}${C.reset} ${v.label}  ${C.dim}${v.lat}, ${v.lng}${C.reset}`);
    }
    console.log(`\n  ${C.dim}Or pass raw coordinates: --at 30.7412,76.7831${C.reset}\n`);
    return;
  }

  if (!URL || !KEY) {
    console.error(
      bad('Missing SUPABASE_URL / SUPABASE_ANON_KEY.\n') +
        `  Copy .env.example to .env and fill it in.\n` +
        `  For a local stack, "supabase status" prints both.`,
    );
    process.exit(1);
  }

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  // Sign in as a real citizen. This matters: it means every insert below
  // goes through the same RLS the phone goes through.
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
    email: args.as,
    password: args.password,
  });
  if (authErr) {
    console.error(bad(`Sign-in failed for ${args.as}: ${authErr.message}`));
    console.error(`  ${C.dim}Has the seed run? Try: npm run db:reset${C.reset}`);
    process.exit(1);
  }
  const uid = auth.user!.id;

  if (args.verify) return verify(sb, uid);

  const spot = resolveSpot(args.at);
  const reason =
    args.reason ?? (args.type === 'medical' ? 'medical_manual' : 'manual');

  console.log('\n' + rule('━'));
  console.log(
    `${C.bold}SafeHer simulator${C.reset}  ${C.dim}·${C.reset}  ` +
      `${args.type === 'medical' ? C.amber + 'MEDICAL' : C.rose + 'SAFETY'} SOS${C.reset}` +
      `${args.silent ? `  ${C.lilac}[SILENT]${C.reset}` : ''}`,
  );
  console.log(`${C.dim}as${C.reset} ${args.as}   ${C.dim}from${C.reset} ${spot.label}`);
  console.log(rule('━'));

  // ---- the press ----
  const t0 = Date.now();
  const { data: incident, error } = await sb.rpc('raise_sos', {
    p_type: args.type,
    p_trigger_reason: reason,
    p_lat: spot.lat,
    p_lng: spot.lng,
    p_accuracy_m: 8 + Math.round(Math.random() * 10),
    p_silent: args.silent,
    p_severity: args.type === 'medical' ? 'critical' : 'high',
  });
  const elapsed = Date.now() - t0;

  if (error || !incident) {
    console.error(bad(`raise_sos failed: ${error?.message}`));
    process.exit(1);
  }
  const inc = incident as Incident;

  console.log(
    `\n  ${C.bold}${C.rose}${inc.public_ref}${C.reset}  ` +
      `${C.dim}raised in${C.reset} ${C.bold}${elapsed} ms${C.reset}` +
      (elapsed < 2000 ? `  ${C.mint}(under the 2s target)${C.reset}` : `  ${C.red}(over 2s)${C.reset}`),
  );

  // ---- show what routing decided, and why ----
  const { data: routingEvent } = await sb
    .from('incident_events')
    .select('payload')
    .eq('incident_id', inc.id)
    .eq('kind', 'routing.resolved')
    .maybeSingle();

  const routing = routingEvent?.payload as RoutingResolvedPayload | undefined;
  if (routing) {
    const stations = routing.stations ?? [];
    const hospitals = routing.hospitals ?? [];
    const primary = args.type === 'medical' && hospitals.length ? hospitals : stations;

    console.log(`\n  ${C.dim}Routed to${C.reset}`);
    primary.forEach((r, i) => {
      const n = r as NearestStation & NearestHospital;
      const chosen = i === 0;
      const trauma = n.has_trauma_unit ? `  ${C.amber}TRAUMA${C.reset}` : '';
      console.log(
        `   ${chosen ? C.mint + '►' : C.grey + ' '} ${C.reset}` +
          `${(chosen ? C.bold : C.grey) + n.name.padEnd(38) + C.reset}` +
          `${formatDistance(n.distance_m).padStart(8)}${trauma}` +
          `${chosen ? '' : C.dim + '   runner-up' + C.reset}`,
      );
    });

    if (args.type === 'medical' && stations.length) {
      console.log(
        `   ${C.dim}+ police backup: ${stations[0].name} ` +
          `(${formatDistance(stations[0].distance_m)})${C.reset}`,
      );
    }
  }

  const snap = inc.medical_snapshot;
  if (snap) {
    console.log(`\n  ${C.dim}Medical record frozen at trigger time${C.reset}`);
    console.log(
      `   ${C.bold}${snap.full_name}${C.reset}${snap.age ? `, ${snap.age}` : ''}   ` +
        `${C.rose}${C.bold}${snap.blood_group ?? '—'}${C.reset}   ` +
        `${C.dim}allergies:${C.reset} ${snap.allergies?.join(', ') || '—'}`,
    );
  }

  // ---- seal the rolling buffer: evidence from BEFORE the press ----
  if (!args.noMedia && !args.silent) {
    console.log(`\n  ${C.dim}Sealing the pre-trigger audio buffer…${C.reset}`);
    for (let i = 3; i >= 1; i--) {
      const capturedAt = new Date(Date.now() - i * 20_000);
      await uploadAudio(sb, inc.id, capturedAt, 20_000, 220 + i * 40, true);
      console.log(
        `   ${C.lilac}▪${C.reset} clip sealed  ` +
          `${C.dim}captured ${i * 20}s BEFORE the alert${C.reset}`,
      );
    }
  } else if (args.silent) {
    console.log(`\n  ${C.lilac}Silent mode — no camera, no audio, no sound on the phone.${C.reset}`);
  }

  console.log(
    `\n  ${C.dim}Streaming location every ${args.interval}s at ${args.walk} m/s. ` +
      `Ctrl-C to stop.${C.reset}\n`,
  );
  console.log(rule());

  // ---- the walk ----
  let tick = 0;
  let pos = { lat: spot.lat, lng: spot.lng };
  // A gently curving track, so the dashboard polyline looks like a person
  // walking rather than a ruler-straight line.
  let heading = Math.random() * Math.PI * 2;
  const started = Date.now();
  let stopping = false;

  const timer = setInterval(async () => {
    if (stopping) return;
    tick++;
    heading += (Math.random() - 0.5) * 0.4;
    const step = args.walk * args.interval;
    pos = offsetMetres(pos, Math.cos(heading) * step, Math.sin(heading) * step);

    const { error: locErr } = await sb.from('incident_locations').insert({
      incident_id: inc.id,
      lat: pos.lat,
      lng: pos.lng,
      accuracy_m: 6 + Math.round(Math.random() * 14),
      speed_mps: args.walk,
    });

    const secs = Math.round((Date.now() - started) / 1000);
    process.stdout.write(
      `\r  ${C.sky}●${C.reset} t+${String(secs).padStart(3)}s  ` +
        `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}  ` +
        `${C.dim}${tick} breadcrumbs${C.reset}` +
        (locErr ? `  ${C.red}${locErr.message}${C.reset}` : '   '),
    );

    if (!args.noMedia && !args.silent) {
      // A snapshot every 15s and an audio segment every 20s, matching
      // what the citizen app does while an incident is open.
      if ((tick * args.interval) % 15 === 0) {
        await uploadPhoto(sb, inc.id, new Date(), tick);
      }
      if ((tick * args.interval) % 20 === 0) {
        await uploadAudio(sb, inc.id, new Date(), 20_000, 300 + (tick % 5) * 30, false);
      }
    }

    if (args.duration > 0 && secs >= args.duration) {
      stopping = true;
      clearInterval(timer);
      await finish();
    }
  }, args.interval * 1000);

  async function finish() {
    console.log(`\n\n${rule()}`);
    const { data: final } = await sb
      .from('incidents')
      .select('status, routing_distance_m')
      .eq('id', inc.id)
      .maybeSingle();
    const { count: locCount } = await sb
      .from('incident_locations')
      .select('*', { count: 'exact', head: true })
      .eq('incident_id', inc.id);
    const { count: mediaCount } = await sb
      .from('incident_media')
      .select('*', { count: 'exact', head: true })
      .eq('incident_id', inc.id);

    console.log(
      `  ${C.bold}${inc.public_ref}${C.reset}  ` +
        `status ${C.bold}${final?.status ?? '?'}${C.reset}  ` +
        `${locCount ?? 0} breadcrumbs  ${mediaCount ?? 0} media`,
    );

    if (args.resolveOnExit) {
      await sb
        .from('incidents')
        .update({ status: 'resolved', resolution_note: 'Closed by simulator' })
        .eq('id', inc.id);
      console.log(`  ${ok('resolved')}`);
    } else {
      console.log(`  ${C.dim}Left open. Resolve it from the dashboard.${C.reset}`);
    }
    console.log(rule() + '\n');
    process.exit(0);
  }

  if (process.platform === 'win32') {
    readline.createInterface({ input: process.stdin, output: process.stdout }).on('SIGINT', () =>
      process.emit('SIGINT' as never),
    );
  }
  process.on('SIGINT', async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await finish();
  });
}

async function uploadAudio(
  sb: ReturnType<typeof createClient>,
  incidentId: string,
  capturedAt: Date,
  durationMs: number,
  hz: number,
  beforeTrigger: boolean,
) {
  const path = mediaPath
    .audio(incidentId, capturedAt.getTime(), beforeTrigger)
    .replace(/\.m4a$/, '.wav');
  const bytes = makeWav(durationMs / 1000, hz);

  const { error: upErr } = await sb.storage
    .from('incident-media')
    .upload(path, bytes, { contentType: 'audio/wav', upsert: true });
  if (upErr) return { error: upErr };

  return sb.from('incident_media').insert({
    incident_id: incidentId,
    kind: 'audio',
    storage_path: path,
    duration_ms: durationMs,
    captured_at: capturedAt.toISOString(),
    before_trigger: beforeTrigger,
  });
}

async function uploadPhoto(
  sb: ReturnType<typeof createClient>,
  incidentId: string,
  capturedAt: Date,
  frame: number,
) {
  const path = mediaPath.photo(incidentId, capturedAt.getTime()).replace(/\.jpg$/, '.png');
  const bytes = makePng(240, 180, frame);

  const { error: upErr } = await sb.storage
    .from('incident-media')
    .upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (upErr) return { error: upErr };

  return sb.from('incident_media').insert({
    incident_id: incidentId,
    kind: 'photo',
    storage_path: path,
    captured_at: capturedAt.toISOString(),
    before_trigger: false,
  });
}

// ---------------------------------------------------------------------
// --verify : assert the things §12 says must be true, from the outside.
// ---------------------------------------------------------------------
async function verify(sb: ReturnType<typeof createClient>, uid: string) {
  console.log(`\n${C.bold}SafeHer — verifying the pipeline${C.reset}`);
  console.log(rule());

  let failures = 0;
  const check = (pass: boolean, label: string, detail = '') => {
    console.log(pass ? ok(label) : bad(label) + (detail ? `  ${C.dim}${detail}${C.reset}` : ''));
    if (!pass) failures++;
  };

  const t0 = Date.now();
  const { data, error } = await sb.rpc('raise_sos', {
    p_type: 'medical',
    p_trigger_reason: 'chest_pain',
    p_lat: DEMO_SPOTS['sector-34'].lat,
    p_lng: DEMO_SPOTS['sector-34'].lng,
    p_accuracy_m: 9,
  });
  const ms = Date.now() - t0;

  if (error || !data) {
    console.log(bad(`raise_sos failed: ${error?.message}`));
    process.exit(1);
  }
  const inc = data as Incident;

  check(ms < 2000, `raise_sos returned in ${ms} ms (target < 2000)`);
  check(!!inc.public_ref, `incident has a public ref (${inc.public_ref})`);
  check(!!inc.assigned_hospital_id, 'assigned_hospital_id is not null');
  check(!!inc.assigned_station_id, 'assigned_station_id is not null (medical gets police too)');
  check(
    inc.routing_distance_m != null && inc.routing_distance_m > 0 && inc.routing_distance_m < 50_000,
    `routing_distance_m is sensible (${formatDistance(inc.routing_distance_m)})`,
  );

  const snap = inc.medical_snapshot;
  check(!!snap?.blood_group, `medical_snapshot is populated (blood group ${snap?.blood_group})`);
  check((snap?.allergies?.length ?? 0) > 0, `snapshot carries allergies (${snap?.allergies?.join(', ')})`);

  const { data: events } = await sb
    .from('incident_events')
    .select('kind, payload')
    .eq('incident_id', inc.id)
    .order('at');

  const kinds = (events ?? []).map((e) => e.kind);
  check(kinds.includes('sos.created'), 'sos.created event written');
  check(kinds.includes('routing.resolved'), 'routing.resolved event written');
  check(kinds.length >= 2, `${kinds.length} timeline events: ${kinds.join(', ')}`);

  const routing = (events ?? []).find((e) => e.kind === 'routing.resolved')
    ?.payload as RoutingResolvedPayload | undefined;
  check(
    (routing?.hospitals?.length ?? 0) > 1,
    `runner-up hospitals recorded for audit (${routing?.hospitals?.length ?? 0})`,
  );

  // The freeze test: change the profile, confirm the incident does not move.
  const before = snap?.blood_group;
  await sb.from('profiles').update({ blood_group: 'ZZ-TEST' }).eq('id', uid);
  const { data: reread } = await sb
    .from('incidents')
    .select('medical_snapshot')
    .eq('id', inc.id)
    .single();
  const after = (reread?.medical_snapshot as typeof snap)?.blood_group;
  await sb.from('profiles').update({ blood_group: before }).eq('id', uid);
  check(after === before, `snapshot is frozen against later profile edits (${before} stayed ${after})`);

  // Routing actually varies with position.
  const { data: far } = await sb.rpc('raise_sos', {
    p_type: 'safety',
    p_trigger_reason: 'manual',
    p_lat: DEMO_SPOTS['manimajra'].lat,
    p_lng: DEMO_SPOTS['manimajra'].lng,
    p_accuracy_m: 12,
  });
  check(
    (far as Incident)?.assigned_station_id !== inc.assigned_station_id,
    'a different location routes to a different station',
  );

  // Clean up after ourselves.
  for (const id of [inc.id, (far as Incident)?.id].filter(Boolean)) {
    await sb
      .from('incidents')
      .update({ status: 'false_alarm', resolution_note: 'simulator --verify' })
      .eq('id', id as string);
  }

  console.log(rule());
  console.log(
    failures === 0
      ? `${C.mint}${C.bold}All checks passed.${C.reset}\n`
      : `${C.red}${C.bold}${failures} check(s) failed.${C.reset}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(bad(String(e?.message ?? e)));
  process.exit(1);
});
