import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { IncidentWithProfile, Responder } from '@safeher/shared';
import type { ConnState } from '../lib/useIncidents';

interface Props {
  responder: Responder;
  placeName: string;
  incidents: IncidentWithProfile[];
  conn: ConnState;
  medical: boolean;
}

export default function TopBar({ responder, placeName, incidents, conn, medical }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const active = incidents.filter(
    (i) => i.status !== 'resolved' && i.status !== 'false_alarm',
  ).length;
  const unack = incidents.filter((i) => i.status === 'new').length;
  const today = new Date().toDateString();
  const resolvedToday = incidents.filter(
    (i) => i.resolved_at && new Date(i.resolved_at).toDateString() === today,
  ).length;

  const accent = medical ? 'text-sh-amber' : 'text-sh-rose';

  return (
    <header
      className="h-14 shrink-0 border-b border-sh-border bg-sh-surface/80 backdrop-blur
                 flex items-center gap-5 px-5"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-extrabold tracking-tight">
          Safe<span className={accent}>Her</span>
        </span>
        <span className="text-[10px] uppercase tracking-[0.22em] text-sh-faint font-semibold">
          {medical ? 'Med' : 'Command'}
        </span>
      </div>

      <div className="h-6 w-px bg-sh-border" />

      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{placeName}</div>
        <div className="text-[11px] text-sh-faint truncate">
          {responder.full_name}
          {responder.badge_no ? ` · ${responder.badge_no}` : ''} ·{' '}
          <span className="uppercase">{responder.role}</span>
          {responder.on_duty && <span className="text-sh-mint"> · on duty</span>}
        </div>
      </div>

      <div className="flex-1" />

      <Counter label="Active" value={active} />
      <Counter
        label="Unacknowledged"
        value={unack}
        // The one counter that must be impossible to ignore.
        tone={unack > 0 ? (medical ? 'amber' : 'rose') : 'idle'}
        pulse={unack > 0}
      />
      <Counter label="Resolved today" value={resolvedToday} tone={resolvedToday ? 'mint' : 'idle'} />

      <div className="h-6 w-px bg-sh-border" />

      <ConnBadge conn={conn} />

      <div className="tabular text-lg font-semibold tracking-tight">
        {now.toLocaleTimeString('en-GB', { hour12: false })}
      </div>

      <button
        onClick={() => supabase.auth.signOut()}
        className="text-xs text-sh-faint hover:text-sh-text border border-sh-border
                   hover:border-sh-rose/60 rounded-md px-2.5 py-1.5 transition"
      >
        Sign out
      </button>
    </header>
  );
}

function Counter({
  label,
  value,
  tone = 'idle',
  pulse = false,
}: {
  label: string;
  value: number;
  tone?: 'idle' | 'rose' | 'amber' | 'mint';
  pulse?: boolean;
}) {
  const color =
    tone === 'rose'
      ? 'text-sh-rose'
      : tone === 'amber'
        ? 'text-sh-amber'
        : tone === 'mint'
          ? 'text-sh-mint'
          : 'text-sh-muted';
  return (
    <div className="text-center px-1">
      <div className={`tabular text-xl font-bold leading-none ${color} ${pulse ? 'blink' : ''}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-sh-faint mt-0.5">{label}</div>
    </div>
  );
}

function ConnBadge({ conn }: { conn: ConnState }) {
  const map = {
    live: { dot: 'bg-sh-mint', text: 'text-sh-mint', label: 'LIVE' },
    connecting: { dot: 'bg-sh-amber', text: 'text-sh-amber', label: 'CONNECTING' },
    dropped: { dot: 'bg-sh-critical', text: 'text-sh-critical', label: 'OFFLINE' },
  }[conn];
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${map.dot} ${conn !== 'live' ? 'blink' : ''}`} />
      <span className={`text-[10px] font-bold tracking-wider ${map.text}`}>{map.label}</span>
    </div>
  );
}
