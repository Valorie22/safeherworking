import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { supabase } from './supabase';
import { mediaPath, RPC, TABLES } from '@safeher/shared';
import { queueSos, flushQueue, smsFallback } from './offline';

/**
 * The SOS engine.
 *
 * Everything that happens between the press and the control room seeing
 * it lives here. Three rules govern this file:
 *
 *   1. The app calls raise_sos() and NOTHING ELSE to create an incident.
 *      Never a raw insert into `incidents`.
 *   2. Nothing blocks the alert. No GPS fix, no microphone permission, no
 *      network — the alert still goes, and we record what degraded.
 *   3. When silent = true the phone does nothing observable. No sound, no
 *      vibration, no visual change, no camera, no auto-play. An officer's
 *      voice coming out of a hidden phone is a safety failure.
 */

// ---------------------------------------------------------------------
// The rolling audio buffer.
//
// This is the feature nobody else has: 60 seconds of audio that was
// already being recorded BEFORE the press. We keep three 20-second
// segments and recycle the oldest. On SOS we seal them and upload with
// before_trigger = true.
//
// (The brief names expo-audio; that module lands in Expo SDK 52. On SDK
// 51 the equivalent is expo-av's Audio.Recording, used here. The
// behaviour is identical — only the import changes.)
// ---------------------------------------------------------------------

const SEGMENT_MS = 20_000;
const BUFFER_SEGMENTS = 3; // 3 x 20s = the 60-second rolling window

class RollingBuffer {
  constructor() {
    this.segments = []; // [{ uri, startedAt, durationMs }]
    this.recording = null;
    this.timer = null;
    this.running = false;
    this.sealed = null;
  }

  async start() {
    if (this.running) return;
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) return false;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });

    this.running = true;
    await this._cycle();
    return true;
  }

  async _cycle() {
    if (!this.running) return;
    try {
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      const startedAt = Date.now();
      await rec.startAsync();
      this.recording = rec;

      this.timer = setTimeout(async () => {
        try {
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          if (uri) {
            this.segments.push({ uri, startedAt, durationMs: Date.now() - startedAt });
            // Recycle: only the most recent 60 seconds is kept.
            while (this.segments.length > BUFFER_SEGMENTS) this.segments.shift();
          }
        } catch {
          /* a dropped segment is not worth killing the buffer over */
        }
        this.recording = null;
        this._cycle();
      }, SEGMENT_MS);
    } catch {
      this.running = false;
    }
  }

  /**
   * Freeze what the buffer holds right now. Called the instant an SOS
   * fires, before anything else, so the evidence cannot be recycled out
   * from under us while the upload runs.
   */
  seal() {
    this.sealed = [...this.segments];
    return this.sealed;
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      if (this.recording) await this.recording.stopAndUnloadAsync();
    } catch {
      /* ignore */
    }
    this.recording = null;
  }
}

export const rollingBuffer = new RollingBuffer();

// ---------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------

async function uploadFile(localUri, storagePath, contentType) {
  // React Native cannot hand a File to supabase-js; fetch the local URI
  // and upload the ArrayBuffer instead.
  const res = await fetch(localUri);
  const bytes = await res.arrayBuffer();
  const { error } = await supabase.storage
    .from('incident-media')
    .upload(storagePath, bytes, { contentType, upsert: true });
  return error;
}

async function uploadSegment(incidentId, seg, beforeTrigger) {
  const capturedAt = new Date(seg.startedAt);
  const path = mediaPath.audio(incidentId, seg.startedAt, beforeTrigger);
  const err = await uploadFile(seg.uri, path, 'audio/m4a');
  if (err) return err;

  return supabase.from(TABLES.incidentMedia).insert({
    incident_id: incidentId,
    kind: 'audio',
    storage_path: path,
    duration_ms: seg.durationMs,
    captured_at: capturedAt.toISOString(),
    before_trigger: beforeTrigger,
  });
}

// ---------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------

/**
 * Best fix we can get in the time we are willing to wait.
 *
 * We wait at most 1.5 seconds. Beyond that the last known position is
 * better than a delayed alert, and we flag it as stale so the control
 * room knows not to trust it to the metre.
 */
export async function bestEffortFix() {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) {
      const req = await Location.requestForegroundPermissionsAsync();
      if (!req.granted) return { coords: null, stale: true, reason: 'permission_denied' };
    }

    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((r) => setTimeout(() => r(null), 1500)),
    ]);
    if (fresh) return { coords: fresh.coords, stale: false };

    const last = await Location.getLastKnownPositionAsync();
    if (last) return { coords: last.coords, stale: true, reason: 'timeout' };

    return { coords: null, stale: true, reason: 'no_fix' };
  } catch {
    return { coords: null, stale: true, reason: 'error' };
  }
}

// ---------------------------------------------------------------------
// raise
// ---------------------------------------------------------------------

/**
 * Fire an SOS.
 *
 * Returns { incident, path } where path is 'realtime' | 'queued', so the
 * UI can tell the user honestly which way the alert actually went out.
 */
export async function raiseSos({ type, reason, silent = false, severity }) {
  // Seal the buffer FIRST. Everything else can take its time.
  const sealed = rollingBuffer.seal();

  if (!silent) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }

  const fix = await bestEffortFix();

  const args = {
    p_type: type,
    p_trigger_reason: reason,
    p_lat: fix.coords?.latitude ?? null,
    p_lng: fix.coords?.longitude ?? null,
    p_accuracy_m: fix.coords?.accuracy != null ? Math.round(fix.coords.accuracy) : null,
    p_silent: silent,
    p_severity: severity ?? (type === 'medical' ? 'critical' : 'high'),
    p_location_stale: fix.stale,
  };

  const { data, error } = await supabase.rpc(RPC.raiseSos, args);

  if (error || !data) {
    // Rule 7: degrade, never dead-end. Queue it, and reach the guardians
    // by SMS — which works with no data connection at all.
    await queueSos(args);
    const sms = await smsFallback(args);
    return { incident: null, path: 'queued', sms, error: error?.message ?? 'unknown' };
  }

  // Upload the sealed pre-trigger evidence. Not awaited as a block —
  // the UI should already be showing the incident.
  if (!silent && sealed?.length) {
    Promise.all(sealed.map((s) => uploadSegment(data.id, s, true))).catch(() => {});
  }

  flushQueue().catch(() => {});

  return { incident: data, path: 'realtime', sealedCount: silent ? 0 : (sealed?.length ?? 0) };
}

// ---------------------------------------------------------------------
// While an incident is open
// ---------------------------------------------------------------------

/**
 * Streams everything the control room watches: a breadcrumb every 5
 * seconds, a 20-second audio segment continuously, and a front-camera
 * snapshot every 15 seconds.
 *
 * Returns a stop() function. Call it when the incident closes.
 */
export function startIncidentStreaming(incident, { onLocation, takeSnapshot } = {}) {
  const silent = !!incident.silent;
  let stopped = false;
  const timers = [];

  // --- breadcrumbs, every 5 seconds ---
  let locSub = null;
  (async () => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      locSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 },
        async (pos) => {
          if (stopped) return;
          onLocation?.(pos.coords);
          await supabase.from(TABLES.incidentLocations).insert({
            incident_id: incident.id,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
            speed_mps: pos.coords.speed ?? null,
          });
        },
      );
    } catch {
      /* location can fail; the incident continues without it */
    }
  })();

  // --- continuous audio, 20s segments, uploaded as they close ---
  if (!silent) {
    const pump = setInterval(async () => {
      if (stopped) return;
      const segs = rollingBuffer.segments;
      const latest = segs[segs.length - 1];
      if (latest && latest.startedAt !== pump._lastSent) {
        pump._lastSent = latest.startedAt;
        uploadSegment(incident.id, latest, false).catch(() => {});
      }
    }, 5000);
    timers.push(pump);

    // --- front-camera snapshot every 15 seconds ---
    if (takeSnapshot) {
      const shot = setInterval(async () => {
        if (stopped) return;
        try {
          const photo = await takeSnapshot();
          if (!photo?.uri) return;
          const capturedAt = Date.now();
          const path = mediaPath.photo(incident.id, capturedAt);
          const err = await uploadFile(photo.uri, path, 'image/jpeg');
          if (err) return;
          await supabase.from(TABLES.incidentMedia).insert({
            incident_id: incident.id,
            kind: 'photo',
            storage_path: path,
            captured_at: new Date(capturedAt).toISOString(),
            before_trigger: false,
          });
        } catch {
          /* a missed frame is not worth surfacing */
        }
      }, 15_000);
      timers.push(shot);
    }
  }

  return function stop() {
    stopped = true;
    timers.forEach(clearInterval);
    locSub?.remove?.();
  };
}

/** "I am safe." Only the citizen or a responder may close an incident. */
export async function resolveIncident(incidentId, note = 'Marked safe by the user') {
  const { error } = await supabase
    .from(TABLES.incidents)
    .update({ status: 'resolved', resolution_note: note })
    .eq('id', incidentId);
  return error?.message ?? null;
}

export async function sendMessage(incidentId, userId, body) {
  if (!body?.trim()) return;
  await supabase.from(TABLES.incidentMessages).insert({
    incident_id: incidentId,
    sender_role: 'citizen',
    sender_id: userId,
    body: body.trim(),
  });
}

/** Push-to-talk from the phone, into the same conversation. */
export async function sendPtt(incidentId, userId, localUri, durationMs) {
  const capturedAt = Date.now();
  const path = mediaPath.ptt(incidentId, capturedAt);
  const err = await uploadFile(localUri, path, 'audio/m4a');
  if (err) return err.message;

  await supabase.from(TABLES.incidentMessages).insert({
    incident_id: incidentId,
    sender_role: 'citizen',
    sender_id: userId,
    audio_path: path,
  });
  await supabase.from(TABLES.incidentEvents).insert({
    incident_id: incidentId,
    actor_type: 'citizen',
    actor_id: userId,
    kind: 'comm.ptt',
    message: `Push-to-talk sent (${(durationMs / 1000).toFixed(1)}s)`,
    payload: { duration_ms: durationMs, path },
  });
  return null;
}
