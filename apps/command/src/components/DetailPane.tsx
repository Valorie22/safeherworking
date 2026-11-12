import { useEffect, useState } from 'react';
import {
  formatAccuracy,
  formatClock,
  formatDistance,
  initials,
  radioSummary,
  triggerLabel,
} from '@safeher/shared';
import type {
  IncidentWithProfile,
  NearestStation,
  Responder,
  RoutingResolvedPayload,
} from '@safeher/shared';
import type { IncidentDetail } from '../lib/useIncidentDetail';
import { reassignStation } from '../lib/actions';
import { StatusPill } from './IncidentQueue';
import LiveFeedPanel from './panels/LiveFeedPanel';
import CommsPanel from './panels/CommsPanel';
import ActionsPanel from './panels/ActionsPanel';
import TimelinePanel from './panels/TimelinePanel';
import HandoverCard from './panels/HandoverCard';

interface Props {
  incident: IncidentWithProfile | null;
  detail: IncidentDetail;
  responder: Responder;
  medical: boolean;
}

export default function DetailPane({ incident, detail, responder, medical }: Props) {
  if (!incident) {
    return (
      <div className="h-full grid place-items-center text-center px-8 border-l border-sh-border">
        <div className="text-sh-faint">
          <div className="text-4xl mb-3 opacity-30">◇</div>
          <p className="text-sm">Select an incident.</p>
          <p className="text-xs mt-1 opacity-70">
            Use <kbd className="px-1 border border-sh-border rounded">↑</kbd>{' '}
            <kbd className="px-1 border border-sh-border rounded">↓</kbd> to move the queue.
          </p>
        </div>
      </div>
    );
  }

  const snap = incident.medical_snapshot;
  const isMedical = incident.type === 'medical';

  // For a medical SOS the medical panel is first and expanded — the
  // blood group should be readable from two metres away.
  const medicalFirst = isMedical || medical;

  return (
    <div className="h-full overflow-y-auto border-l border-sh-border bg-sh-bg-deep/30">
      <Header incident={incident} />

      <div className="p-3 space-y-3">
        {medicalFirst && <MedicalPanel incident={incident} big />}

        <IdentityPanel incident={incident} detail={detail} />

        {!medicalFirst && <MedicalPanel incident={incident} />}

        <LocationPanel incident={incident} detail={detail} />

        <RoutingPanel
          incident={incident}
          detail={detail}
          responder={responder}
          medical={medical}
        />

        {medical && <HandoverCard incident={incident} detail={detail} />}

        <LiveFeedPanel incident={incident} media={detail.media} />

        <CommsPanel incident={incident} detail={detail} responder={responder} />

        <ActionsPanel incident={incident} detail={detail} responder={responder} medical={medical} />

        <TimelinePanel events={detail.events} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------

function Header({ incident }: { incident: IncidentWithProfile }) {
  const isMedical = incident.type === 'medical';
  return (
    <div
      className={`sticky top-0 z-10 px-4 py-3 border-b backdrop-blur
        ${isMedical ? 'bg-sh-amber/10 border-sh-amber/40' : 'bg-sh-rose/10 border-sh-rose/40'}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded
            ${isMedical ? 'bg-sh-amber text-[#231400]' : 'bg-sh-rose text-[#2A0413]'}`}
        >
          {isMedical ? 'MEDICAL SOS' : 'SAFETY SOS'}
        </span>
        <span className="tabular font-bold text-lg">{incident.public_ref}</span>
        <StatusPill status={incident.status} />
        {incident.silent && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sh-lilac/20 text-sh-lilac border border-sh-lilac/40">
            SILENT
          </span>
        )}
      </div>
      <div className="text-[11px] text-sh-muted mt-1">
        {triggerLabel(incident.trigger_reason)} · raised {formatClock(incident.created_at)}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  tone = 'default',
  defaultOpen = true,
  right,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'default' | 'medical' | 'safety';
  defaultOpen?: boolean;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const border =
    tone === 'medical'
      ? 'border-sh-amber/45'
      : tone === 'safety'
        ? 'border-sh-rose/45'
        : 'border-sh-border';
  return (
    <section className={`rounded-xl border ${border} bg-sh-surface overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sh-border-soft">
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[10px] font-bold uppercase tracking-[0.18em] text-sh-faint hover:text-sh-muted flex items-center gap-1.5"
        >
          <span className={`transition ${open ? 'rotate-90' : ''}`}>›</span>
          {title}
        </button>
        <div className="ml-auto">{right}</div>
      </div>
      {open && <div className="p-3">{children}</div>}
    </section>
  );
}

// ---- 1. Identity -----------------------------------------------------

function IdentityPanel({
  incident,
  detail,
}: {
  incident: IncidentWithProfile;
  detail: IncidentDetail;
}) {
  const snap = incident.medical_snapshot;
  const p = detail.profile;
  const name = p?.full_name ?? snap?.full_name ?? 'Unknown';
  const photo = p?.photo_url ?? snap?.photo_url ?? null;

  return (
    <Panel title="Identity">
      <div className="flex gap-3">
        {photo ? (
          <img
            src={photo}
            alt=""
            className="w-16 h-16 rounded-xl object-cover border border-sh-border"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl grid place-items-center bg-sh-rose/12 border border-sh-rose/35 text-sh-rose-soft font-bold text-lg">
            {initials(name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-bold text-lg leading-tight">{name}</div>
          <div className="text-xs text-sh-muted mt-0.5">
            {snap?.age != null && <>{snap.age} years</>}
            {snap?.gender && <> · {snap.gender}</>}
          </div>
          <Field label="Phone" value={p?.phone ?? snap?.phone} mono />
          <Field label="Home" value={p?.address ?? snap?.address} />
        </div>
      </div>
    </Panel>
  );
}

// ---- 2. Medical ------------------------------------------------------

function MedicalPanel({ incident, big = false }: { incident: IncidentWithProfile; big?: boolean }) {
  const s = incident.medical_snapshot;

  if (!s) {
    return (
      <Panel title="Medical" tone="medical">
        <p className="text-sh-faint text-sm">No medical record was captured with this alert.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Medical — frozen at trigger time"
      tone="medical"
      right={
        <span className="text-[9px] text-sh-faint">
          {s.frozen_at ? formatClock(s.frozen_at) : ''}
        </span>
      }
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0">
          <div className="text-[9px] uppercase tracking-[0.18em] text-sh-faint">Blood group</div>
          <div
            className={`font-extrabold text-sh-amber leading-none tracking-tight ${
              big ? 'text-6xl' : 'text-4xl'
            }`}
          >
            {s.blood_group ?? '—'}
          </div>
          {s.organ_donor && (
            <div className="mt-2 text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-sh-mint/20 text-sh-mint border border-sh-mint/40 inline-block">
              ORGAN DONOR
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <Tags label="Allergies" items={s.allergies} tone="critical" />
          <Tags label="Conditions" items={s.conditions} tone="amber" />
          <Tags label="Medications" items={s.medications} tone="muted" />
        </div>
      </div>

      {s.emergency_note && (
        <div className="mt-3 rounded-lg border border-sh-amber/40 bg-sh-amber/8 px-3 py-2">
          <div className="text-[9px] uppercase tracking-[0.18em] text-sh-amber font-bold mb-0.5">
            Emergency note
          </div>
          <p className={`text-sh-amber-soft ${big ? 'text-sm' : 'text-xs'} leading-snug`}>
            {s.emergency_note}
          </p>
        </div>
      )}
    </Panel>
  );
}

function Tags({
  label,
  items,
  tone,
}: {
  label: string;
  items?: string[] | null;
  tone: 'critical' | 'amber' | 'muted';
}) {
  const cls = {
    critical: 'bg-sh-critical/15 text-sh-critical border-sh-critical/40',
    amber: 'bg-sh-amber/15 text-sh-amber-soft border-sh-amber/40',
    muted: 'bg-sh-surface-alt text-sh-muted border-sh-border',
  }[tone];

  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.18em] text-sh-faint">{label}</div>
      <div className="flex flex-wrap gap-1 mt-0.5">
        {items?.length ? (
          items.map((i) => (
            <span key={i} className={`text-[11px] px-1.5 py-0.5 rounded border ${cls}`}>
              {i}
            </span>
          ))
        ) : (
          <span className="text-[11px] text-sh-faint">none recorded</span>
        )}
      </div>
    </div>
  );
}

// ---- 3. Location -----------------------------------------------------

function LocationPanel({
  incident,
  detail,
}: {
  incident: IncidentWithProfile;
  detail: IncidentDetail;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const last = detail.locations[detail.locations.length - 1];
  const lat = last?.lat ?? incident.lat;
  const lng = last?.lng ?? incident.lng;

  // Reverse geocoding is a nicety, not a dependency. If Nominatim is
  // slow, rate-limited or blocked, the panel simply shows coordinates.
  useEffect(() => {
    if (incident.lat == null || incident.lng == null) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${incident.lat}&lon=${incident.lng}&zoom=17`,
          { headers: { Accept: 'application/json' } },
        );
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setAddress(j.display_name ?? null);
      } catch {
        /* coordinates are enough */
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [incident.lat, incident.lng]);

  async function copyForRadio() {
    const text = radioSummary(
      incident,
      incident.type === 'medical' ? detail.hospital?.name : detail.station?.name,
      address,
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy for radio:', text);
    }
  }

  return (
    <Panel
      title="Location"
      right={
        <button
          onClick={copyForRadio}
          className="text-[10px] font-semibold px-2 py-1 rounded border border-sh-border
                     text-sh-muted hover:text-sh-text hover:border-sh-rose/60 transition"
        >
          {copied ? 'Copied ✓' : 'Copy for radio'}
        </button>
      }
    >
      {lat == null ? (
        <p className="text-sh-critical text-sm">
          No GPS fix at trigger time. The alert was raised anyway — routing is deferred.
        </p>
      ) : (
        <>
          <div className="tabular text-sm">
            {lat.toFixed(5)}, {lng!.toFixed(5)}
          </div>
          <Field label="Accuracy" value={formatAccuracy(last?.accuracy_m ?? incident.accuracy_m)} />
          <Field
            label="Last update"
            value={last ? `${formatClock(last.captured_at)} · ${detail.locations.length} points` : 'trigger point only'}
          />
          <Field label="Address" value={address ?? 'resolving…'} />
        </>
      )}
    </Panel>
  );
}

// ---- 4. Routing ------------------------------------------------------

function RoutingPanel({
  incident,
  detail,
  responder,
  medical,
}: {
  incident: IncidentWithProfile;
  detail: IncidentDetail;
  responder: Responder;
  medical: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const routingEvent = detail.events.find((e) => e.kind === 'routing.resolved');
  const payload = routingEvent?.payload as RoutingResolvedPayload | undefined;
  const candidates = medical || incident.type === 'medical' ? payload?.hospitals : payload?.stations;
  const chosenId =
    medical || incident.type === 'medical'
      ? incident.assigned_hospital_id
      : incident.assigned_station_id;
  const assignedName =
    medical || incident.type === 'medical' ? detail.hospital?.name : detail.station?.name;

  async function reassign(s: NearestStation) {
    const reason = window.prompt(
      `Reassign ${incident.public_ref} to ${s.name}. Reason (recorded on the timeline):`,
    );
    if (!reason?.trim()) return;
    setBusy(true);
    const { error } = await reassignStation(incident.id, s.id, reason.trim());
    setErr(error);
    setBusy(false);
  }

  return (
    <Panel title="Routing — resolved server-side">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{assignedName ?? 'Not routed'}</span>
        <span className="tabular text-sh-lilac font-semibold">
          {formatDistance(incident.routing_distance_m)}
        </span>
      </div>
      {payload?.resolved_in_ms != null && (
        <div className="text-[10px] text-sh-faint mt-0.5">
          decided in {payload.resolved_in_ms} ms, before the alert reached this screen
        </div>
      )}

      {candidates && candidates.length > 1 && (
        <div className="mt-3">
          <div className="text-[9px] uppercase tracking-[0.18em] text-sh-faint mb-1">
            Considered · why this one
          </div>
          <div className="space-y-1">
            {candidates.map((c) => {
              const chosen = c.id === chosenId;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 border ${
                    chosen
                      ? 'bg-sh-lilac/12 border-sh-lilac/50'
                      : 'bg-sh-surface-alt/50 border-sh-border-soft'
                  }`}
                >
                  <span className={chosen ? 'text-sh-lilac' : 'text-sh-faint'}>
                    {chosen ? '►' : '·'}
                  </span>
                  <span className={`flex-1 truncate ${chosen ? 'font-semibold' : 'text-sh-muted'}`}>
                    {c.name}
                  </span>
                  {'has_trauma_unit' in c && c.has_trauma_unit && (
                    <span className="text-[9px] font-bold px-1 rounded bg-sh-amber/20 text-sh-amber">
                      TRAUMA
                    </span>
                  )}
                  <span className="tabular text-sh-muted">{formatDistance(c.distance_m)}</span>
                  {!chosen && responder.role === 'supervisor' && !medical && (
                    <button
                      disabled={busy}
                      onClick={() => reassign(c as NearestStation)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-sh-border
                                 hover:border-sh-lilac hover:text-sh-lilac transition"
                    >
                      Reassign
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {responder.role !== 'supervisor' && !medical && (
            <p className="text-[10px] text-sh-faint mt-1.5">
              Reassignment across stations is a supervisor action.
            </p>
          )}
        </div>
      )}

      {err && <p className="text-sh-critical text-xs mt-2">{err}</p>}
    </Panel>
  );
}

// ---- small helpers ---------------------------------------------------

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="mt-1.5">
      <div className="text-[9px] uppercase tracking-[0.18em] text-sh-faint">{label}</div>
      <div className={`text-xs text-sh-text ${mono ? 'tabular' : ''}`}>{value || '—'}</div>
    </div>
  );
}

export { Panel, Field };
