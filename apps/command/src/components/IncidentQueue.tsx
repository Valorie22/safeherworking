import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatAge,
  formatDistance,
  initials,
  statusLabel,
  triggerLabel,
} from '@safeher/shared';
import type { IncidentStatus, IncidentType, IncidentWithProfile } from '@safeher/shared';

interface Props {
  incidents: IncidentWithProfile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  medical: boolean;
}

const STATUS_FILTERS: (IncidentStatus | 'all' | 'open')[] = [
  'open',
  'new',
  'acknowledged',
  'dispatched',
  'resolved',
  'all',
];

export default function IncidentQueue({ incidents, selectedId, onSelect, medical }: Props) {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('open');
  const [typeFilter, setTypeFilter] = useState<IncidentType | 'all'>('all');
  const listRef = useRef<HTMLDivElement>(null);

  // One ticking clock for the whole list, not one per card.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    return incidents.filter((i) => {
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'open') return i.status !== 'resolved' && i.status !== 'false_alarm';
      return i.status === statusFilter;
    });
  }, [incidents, statusFilter, typeFilter]);

  // A NEW incident sits above everything else regardless of age — an
  // unacknowledged alert outranks a busy hour of older traffic.
  const ordered = useMemo(() => {
    const isNew = (i: IncidentWithProfile) => (i.status === 'new' ? 0 : 1);
    return [...filtered].sort(
      (a, b) => isNew(a) - isNew(b) || +new Date(b.created_at) - +new Date(a.created_at),
    );
  }, [filtered]);

  // Keyboard: up/down move the queue, Enter opens. Space is push-to-talk
  // and is handled by the comms panel, so it is deliberately not bound here.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const idx = ordered.findIndex((i) => i.id === selectedId);
      const next =
        e.key === 'ArrowDown'
          ? Math.min(ordered.length - 1, idx + 1)
          : Math.max(0, idx <= 0 ? 0 : idx - 1);
      if (ordered[next]) onSelect(ordered[next].id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selectedId, onSelect]);

  return (
    <div className="flex flex-col h-full border-r border-sh-border bg-sh-bg-deep/40">
      <div className="px-3 pt-3 pb-2 border-b border-sh-border-soft">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-sh-faint">
            Incident queue
          </h2>
          <span className="tabular text-xs text-sh-muted">{ordered.length}</span>
        </div>

        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f} active={statusFilter === f} onClick={() => setStatusFilter(f)}>
              {f === 'open' ? 'Open' : f === 'all' ? 'All' : statusLabel(f)}
            </Chip>
          ))}
        </div>

        {!medical && (
          <div className="flex gap-1 mt-1.5">
            {(['all', 'safety', 'medical'] as const).map((t) => (
              <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)} small>
                {t === 'all' ? 'Both types' : t.toUpperCase()}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {ordered.length === 0 && (
          <div className="text-center text-sh-faint text-sm py-16 px-4">
            <div className="text-3xl mb-2 opacity-40">○</div>
            No incidents.
            <div className="text-xs mt-1 opacity-70">
              Waiting for an alert. The counter above stays at zero until one arrives.
            </div>
          </div>
        )}

        {ordered.map((i) => (
          <Card
            key={i.id}
            incident={i}
            selected={i.id === selectedId}
            onClick={() => onSelect(i.id)}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  small,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border transition ${small ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1'} ${
        active
          ? 'bg-sh-rose/15 border-sh-rose/70 text-sh-rose-soft'
          : 'bg-transparent border-sh-border text-sh-faint hover:text-sh-muted hover:border-sh-border'
      }`}
    >
      {children}
    </button>
  );
}

function Card({
  incident,
  selected,
  onClick,
  now,
}: {
  incident: IncidentWithProfile;
  selected: boolean;
  onClick: () => void;
  now: number;
}) {
  const isNew = incident.status === 'new';
  const medical = incident.type === 'medical';
  const name = incident.profile?.full_name ?? incident.medical_snapshot?.full_name ?? 'Unknown';
  const photo = incident.profile?.photo_url ?? incident.medical_snapshot?.photo_url ?? null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition relative overflow-hidden
        ${isNew ? (medical ? 'pulse-new-medical border-sh-amber' : 'pulse-new border-sh-rose') : ''}
        ${
          selected
            ? 'bg-sh-surface-hi border-sh-lilac'
            : isNew
              ? ''
              : 'bg-sh-surface border-sh-border-soft hover:border-sh-border hover:bg-sh-surface-alt'
        }`}
    >
      <div className="flex items-start gap-2.5">
        <Avatar name={name} photo={photo} medical={medical} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[9px] font-extrabold tracking-wider px-1.5 py-0.5 rounded
                ${medical ? 'bg-sh-amber text-[#231400]' : 'bg-sh-rose text-[#2A0413]'}`}
            >
              {medical ? 'MEDICAL' : 'SAFETY'}
            </span>
            {incident.silent && (
              <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-sh-lilac/20 text-sh-lilac border border-sh-lilac/40">
                SILENT
              </span>
            )}
            <span className="tabular text-[10px] text-sh-faint ml-auto">
              {incident.public_ref}
            </span>
          </div>

          <div className="font-semibold text-sm truncate mt-1">{name}</div>

          <div className="text-[11px] text-sh-muted truncate">
            {triggerLabel(incident.trigger_reason)}
          </div>

          <div className="flex items-center gap-2 mt-1.5">
            <StatusPill status={incident.status} />
            <span className="tabular text-[11px] text-sh-faint">
              {formatDistance(incident.routing_distance_m)}
            </span>
            <span
              className={`tabular text-[11px] ml-auto font-semibold ${
                isNew ? 'text-sh-rose' : 'text-sh-faint'
              }`}
            >
              {formatAge(incident.created_at, now)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function Avatar({
  name,
  photo,
  medical,
}: {
  name: string;
  photo: string | null;
  medical: boolean;
}) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className="w-10 h-10 rounded-lg object-cover border border-sh-border shrink-0"
      />
    );
  }
  return (
    <div
      className={`w-10 h-10 rounded-lg grid place-items-center text-xs font-bold shrink-0
        border ${
          medical
            ? 'bg-sh-amber/15 border-sh-amber/40 text-sh-amber-soft'
            : 'bg-sh-rose/15 border-sh-rose/40 text-sh-rose-soft'
        }`}
    >
      {initials(name)}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const cls =
    {
      new: 'bg-sh-rose/20 text-sh-rose border-sh-rose/50',
      acknowledged: 'bg-sh-lilac/20 text-sh-lilac border-sh-lilac/50',
      assigned: 'bg-sh-sky/20 text-sh-sky border-sh-sky/50',
      dispatched: 'bg-sh-sky/20 text-sh-sky border-sh-sky/50',
      enroute: 'bg-sh-amber/20 text-sh-amber border-sh-amber/50',
      onscene: 'bg-sh-amber/20 text-sh-amber border-sh-amber/50',
      resolved: 'bg-sh-mint/20 text-sh-mint border-sh-mint/50',
      false_alarm: 'bg-sh-grey/20 text-sh-grey border-sh-grey/50',
    }[status] ?? 'bg-sh-grey/20 text-sh-faint border-sh-border';

  return (
    <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {statusLabel(status)}
    </span>
  );
}
