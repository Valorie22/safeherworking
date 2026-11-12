import { supabase } from './supabase';
import { mediaPath, TABLES } from '@safeher/shared';

/**
 * The alert tone, synthesised rather than shipped as a file — no asset
 * to go missing, and it works offline.
 *
 * Two rising notes: attention-getting without being a fire alarm. A
 * control room hears this a hundred times a shift, so it must not be
 * the kind of sound that makes people turn the volume down.
 */
let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function playAlertTone(type: 'safety' | 'medical' = 'safety') {
  const ac = audioContext();
  if (!ac) return;
  // Medical sits a fifth below safety, so the two are distinguishable
  // without looking at the screen.
  const base = type === 'medical' ? 587.33 : 880;
  const notes = [base, base * 1.26];

  notes.forEach((hz, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = hz;
    const t = ac.currentTime + i * 0.16;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  });
}

/** Browsers block audio until a gesture. Call this from the login click. */
export function unlockAudio() {
  const ac = audioContext();
  if (ac && ac.state === 'suspended') void ac.resume();
}

/**
 * Push-to-talk, tier 1 of §3.6.
 *
 * This is the feature, not a fallback: it works on a bad network, it
 * leaves a permanent audio record attached to the incident, and it means
 * an officer never gets handed a phone number.
 */
export class PushToTalk {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stream: MediaStream | null = null;
  private startedAt = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4';
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.startedAt = Date.now();
    this.recorder.start();
  }

  /** Stops, uploads, and writes the message row. Returns the storage path. */
  async stopAndSend(incidentId: string, senderId: string): Promise<string | null> {
    if (!this.recorder) return null;
    const rec = this.recorder;
    const durationMs = Date.now() - this.startedAt;

    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType }));
      rec.stop();
    });

    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = null;
    this.stream = null;

    // Anything under a third of a second is a mis-click, not a message.
    if (durationMs < 300) return null;

    const ext = rec.mimeType.includes('webm') ? 'webm' : 'mp4';
    const path = mediaPath.ptt(incidentId, Date.now()).replace(/\.m4a$/, `.${ext}`);

    const { error: upErr } = await supabase.storage
      .from('incident-media')
      .upload(path, blob, { contentType: rec.mimeType, upsert: true });
    if (upErr) {
      console.error('PTT upload failed', upErr);
      return null;
    }

    await supabase.from(TABLES.incidentMessages).insert({
      incident_id: incidentId,
      sender_role: 'responder',
      sender_id: senderId,
      audio_path: path,
    });

    await supabase.from(TABLES.incidentEvents).insert({
      incident_id: incidentId,
      actor_type: 'responder',
      actor_id: senderId,
      kind: 'comm.ptt',
      message: `Push-to-talk sent (${(durationMs / 1000).toFixed(1)}s)`,
      payload: { duration_ms: durationMs, path },
    });

    return path;
  }

  cancel() {
    try {
      this.recorder?.stop();
    } catch {
      /* already stopped */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = null;
    this.stream = null;
  }

  get active() {
    return this.recorder !== null;
  }
}
