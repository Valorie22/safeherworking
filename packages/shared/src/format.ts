import type { Incident, MedicalSnapshot } from './types';

/** "800 m" / "1.4 km" — the distance an officer reads off the routing panel. */
export function formatDistance(metres: number | null | undefined): string {
  if (metres == null || Number.isNaN(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

/**
 * The age counter on a queue card. Ticks in seconds for the first
 * minute, because the first minute is the one that matters.
 */
export function formatAge(fromIso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Second-precision timestamp for the audit timeline. Never relative. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour12: false })
  );
}

/** GPS accuracy, phrased so a non-technical reader knows if it is good. */
export function formatAccuracy(m: number | null | undefined): string {
  if (m == null) return 'unknown';
  if (m <= 15) return `±${Math.round(m)} m (good)`;
  if (m <= 50) return `±${Math.round(m)} m (fair)`;
  return `±${Math.round(m)} m (poor)`;
}

export function triggerLabel(reason: string): string {
  return (
    {
      manual: 'Manual press',
      shake: 'Shake detected',
      duress: 'DURESS PIN',
      acoustic: 'Sustained loud audio',
      journey: 'Missed journey check-in',
      battery: 'Critical battery',
      medical_manual: 'Manual — medical',
      fall: 'Fall detected',
      chest_pain: 'Chest pain',
      breathing: 'Difficulty breathing',
      bleeding: 'Bleeding',
      unconscious: 'Unconscious',
      accident: 'Accident',
      other: 'Other (unspecified)',
    }[reason] ?? reason
  );
}

/**
 * The "Copy for radio" button (§8 panel 3). One line an officer can read
 * aloud without parsing a screen. Deliberately spells out the blood group
 * letter-by-letter risk words — "O negative", not "O-".
 */
export function radioSummary(
  incident: Incident,
  stationName?: string | null,
  address?: string | null,
): string {
  const s = incident.medical_snapshot as MedicalSnapshot | null;
  const bits: string[] = [];

  bits.push(`${incident.public_ref}.`);
  bits.push(`${incident.type === 'medical' ? 'Medical' : 'Safety'} emergency.`);
  if (s?.full_name) bits.push(`${s.full_name}${s.age ? `, age ${s.age}` : ''}.`);
  if (incident.lat != null && incident.lng != null) {
    bits.push(`Location ${incident.lat.toFixed(5)}, ${incident.lng.toFixed(5)}.`);
  }
  if (address) bits.push(`${address}.`);
  if (incident.accuracy_m != null) bits.push(`Accuracy ${Math.round(incident.accuracy_m)} metres.`);
  if (s?.blood_group) bits.push(`Blood group ${s.blood_group}.`);
  if (s?.allergies?.length) bits.push(`Allergies: ${s.allergies.join(', ')}.`);
  if (s?.conditions?.length) bits.push(`Conditions: ${s.conditions.join(', ')}.`);
  if (stationName) bits.push(`Assigned ${stationName}, ${formatDistance(incident.routing_distance_m)}.`);
  bits.push(`Trigger: ${triggerLabel(incident.trigger_reason)}.`);

  return bits.join(' ');
}

/** "captured 40s BEFORE the alert" — the label that carries the whole pitch. */
export function preTriggerLabel(capturedAtIso: string, incidentCreatedIso: string): string {
  const delta = Math.round(
    (new Date(incidentCreatedIso).getTime() - new Date(capturedAtIso).getTime()) / 1000,
  );
  return `captured ${Math.max(0, delta)}s BEFORE the alert`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Countdown for the dead-man's switch, shown to the parent. */
export function formatCountdown(targetIso: string, now: number = Date.now()): string {
  const secs = Math.round((new Date(targetIso).getTime() - now) / 1000);
  if (secs <= 0) return 'OVERDUE';
  const m = Math.floor(secs / 60);
  return m > 0 ? `${m}:${String(secs % 60).padStart(2, '0')}` : `0:${String(secs).padStart(2, '0')}`;
}
