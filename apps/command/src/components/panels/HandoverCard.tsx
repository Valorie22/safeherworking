import { formatDistance } from '@safeher/shared';
import type { IncidentWithProfile } from '@safeher/shared';
import type { IncidentDetail } from '../../lib/useIncidentDetail';
import { Panel } from '../DetailPane';

/**
 * Pre-arrival handover (§9).
 *
 * An ER team has about ten seconds before the trolley arrives. This is
 * what they read in those ten seconds, and it prints on one page.
 */
export default function HandoverCard({
  incident,
  detail,
}: {
  incident: IncidentWithProfile;
  detail: IncidentDetail;
}) {
  const s = incident.medical_snapshot;
  if (!s) return null;

  return (
    <Panel
      title="Pre-arrival handover"
      tone="medical"
      right={
        <button
          onClick={() => window.print()}
          className="text-[10px] font-semibold px-2 py-1 rounded border border-sh-border
                     text-sh-muted hover:text-sh-text hover:border-sh-amber/60 transition"
        >
          Print
        </button>
      }
    >
      <div className="rounded-lg border border-sh-amber/40 bg-sh-amber/6 p-3">
        <div className="flex items-baseline justify-between">
          <span className="font-extrabold text-lg">{s.full_name}</span>
          <span className="tabular text-xs text-sh-muted">{incident.public_ref}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-2">
          <Cell label="Age" value={s.age != null ? String(s.age) : '—'} />
          <Cell label="Blood" value={s.blood_group ?? '—'} big />
          <Cell label="ETA" value={detail.unit ? detail.unit.status : 'not dispatched'} />
        </div>

        <Row label="Presenting" value={incident.trigger_reason.replace(/_/g, ' ')} />
        <Row label="Allergies" value={s.allergies?.join(', ') || 'none recorded'} critical />
        <Row label="Medications" value={s.medications?.join(', ') || 'none recorded'} />
        <Row label="Conditions" value={s.conditions?.join(', ') || 'none recorded'} />
        <Row
          label="Ambulance"
          value={detail.unit ? detail.unit.callsign : 'unassigned'}
        />
        <Row
          label="Destination"
          value={
            detail.hospital
              ? `${detail.hospital.name} · ${formatDistance(incident.routing_distance_m)}`
              : 'unassigned'
          }
        />
        {s.emergency_note && <Row label="Note" value={s.emergency_note} />}
      </div>
    </Panel>
  );
}

function Cell({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-md bg-sh-bg-deep/50 px-2 py-1.5">
      <div className="text-[8px] uppercase tracking-[0.18em] text-sh-faint">{label}</div>
      <div className={`font-bold ${big ? 'text-2xl text-sh-amber leading-none' : 'text-sm'}`}>
        {value}
      </div>
    </div>
  );
}

function Row({ label, value, critical }: { label: string; value: string; critical?: boolean }) {
  return (
    <div className="flex gap-2 text-xs mt-1.5">
      <span className="text-sh-faint w-20 shrink-0 uppercase text-[9px] tracking-wider pt-0.5">
        {label}
      </span>
      <span className={critical ? 'text-sh-critical font-semibold' : 'text-sh-text'}>{value}</span>
    </div>
  );
}
