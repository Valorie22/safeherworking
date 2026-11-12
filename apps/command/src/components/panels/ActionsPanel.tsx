import { useEffect, useState } from 'react';
import { formatDistance } from '@safeher/shared';
import type { IncidentWithProfile, NearestUnit, Responder } from '@safeher/shared';
import { acknowledge, assignUnit, crossDispatch, nearestUnits, setStatus } from '../../lib/actions';
import type { IncidentDetail } from '../../lib/useIncidentDetail';
import { Panel } from '../DetailPane';

/**
 * Every button here writes an incident_events row — but none of them
 * writes it by hand. The database trigger does it, so a state change
 * that forgot to log itself is not expressible.
 */
export default function ActionsPanel({
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
  const [units, setUnits] = useState<NearestUnit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const closed = incident.status === 'resolved' || incident.status === 'false_alarm';

  useEffect(() => {
    if (incident.lat == null) return;
    nearestUnits(incident.lat, incident.lng!, medical ? 'ambulance' : undefined).then(setUnits);
  }, [incident.id, incident.lat, incident.lng, medical]);

  async function run(key: string, fn: () => Promise<{ error: string | null }>) {
    setBusy(key);
    setErr(null);
    const { error } = await fn();
    if (error) setErr(error);
    setBusy(null);
  }

  // Enter acknowledges, per the keyboard contract.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter' && incident.status === 'new') {
        e.preventDefault();
        void run('ack', () => acknowledge(incident.id, responder.id));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident.id, incident.status, responder.id]);

  const available = units.filter((u) => u.status === 'available');

  return (
    <Panel title="Actions">
      {closed ? (
        <div className="text-xs">
          <span className="text-sh-mint font-semibold">Closed.</span>{' '}
          <span className="text-sh-muted">{incident.resolution_note}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Action
              primary
              disabled={incident.status !== 'new'}
              busy={busy === 'ack'}
              onClick={() => run('ack', () => acknowledge(incident.id, responder.id))}
            >
              Acknowledge ⏎
            </Action>
            <Action
              busy={busy === 'disp'}
              onClick={() => run('disp', () => setStatus(incident.id, 'dispatched'))}
            >
              Dispatch
            </Action>
            <Action
              busy={busy === 'en'}
              onClick={() => run('en', () => setStatus(incident.id, 'enroute'))}
            >
              {medical ? 'Ambulance en route' : 'Mark en route'}
            </Action>
            <Action
              busy={busy === 'scene'}
              onClick={() => run('scene', () => setStatus(incident.id, 'onscene'))}
            >
              On scene
            </Action>
            {medical && (
              <>
                <Action
                  busy={busy === 'collected'}
                  onClick={() =>
                    run('collected', () =>
                      setStatus(incident.id, 'onscene', 'Patient collected'),
                    )
                  }
                >
                  Patient collected
                </Action>
                <Action
                  busy={busy === 'arrived'}
                  onClick={() =>
                    run('arrived', () =>
                      setStatus(incident.id, 'onscene', 'Arrived at hospital'),
                    )
                  }
                >
                  Arrived at hospital
                </Action>
              </>
            )}
          </div>

          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-sh-faint mb-1">
              {medical ? 'Assign ambulance' : 'Assign unit'} · nearest first
            </div>
            {available.length === 0 ? (
              <p className="text-[11px] text-sh-faint">No available units in range.</p>
            ) : (
              <div className="space-y-1">
                {available.slice(0, 4).map((u) => (
                  <button
                    key={u.id}
                    disabled={busy === u.id}
                    onClick={() => run(u.id, () => assignUnit(incident.id, u.id))}
                    className="w-full flex items-center gap-2 text-xs rounded-lg px-2 py-1.5
                               bg-sh-surface-alt/60 border border-sh-border-soft
                               hover:border-sh-mint/60 transition disabled:opacity-50"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-sh-mint" />
                    <span className="font-semibold">{u.callsign}</span>
                    <span className="text-sh-faint">{u.kind}</span>
                    <span className="tabular text-sh-muted ml-auto">
                      {formatDistance(u.distance_m)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {detail.unit && (
              <p className="text-[11px] text-sh-mint mt-1">
                Assigned: {detail.unit.callsign} ({detail.unit.status})
              </p>
            )}
          </div>

          {/* Cross-dispatch, both directions. A road accident needs both. */}
          <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-sh-border-soft">
            {medical ? (
              <Action
                tone="rose"
                busy={busy === 'x-police'}
                onClick={() =>
                  run('x-police', async () => {
                    const r = await crossDispatch(incident.id, 'police');
                    return { error: r.error };
                  })
                }
              >
                Request police support
              </Action>
            ) : (
              <Action
                tone="amber"
                busy={busy === 'x-amb'}
                onClick={() =>
                  run('x-amb', async () => {
                    const r = await crossDispatch(incident.id, 'medical');
                    return { error: r.error };
                  })
                }
              >
                Escalate to Medical
              </Action>
            )}
            <Action
              tone="mint"
              busy={busy === 'res'}
              onClick={() => {
                const note = window.prompt('Resolution note (required):');
                if (!note?.trim()) return;
                void run('res', () => setStatus(incident.id, 'resolved', note.trim()));
              }}
            >
              Resolve
            </Action>
            <Action
              tone="grey"
              busy={busy === 'false'}
              onClick={() => {
                const note = window.prompt('Why is this a false alarm? (required):');
                if (!note?.trim()) return;
                void run('false', () => setStatus(incident.id, 'false_alarm', note.trim()));
              }}
            >
              False alarm
            </Action>
          </div>
        </div>
      )}

      {err && <p className="text-sh-critical text-xs mt-2">{err}</p>}
    </Panel>
  );
}

function Action({
  children,
  onClick,
  disabled,
  busy,
  primary,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
  tone?: 'rose' | 'amber' | 'mint' | 'grey';
}) {
  const cls = primary
    ? 'bg-sh-rose text-[#2A0413] hover:bg-sh-rose-soft font-bold'
    : tone === 'rose'
      ? 'bg-sh-rose/12 text-sh-rose border border-sh-rose/45 hover:bg-sh-rose/22'
      : tone === 'amber'
        ? 'bg-sh-amber/12 text-sh-amber border border-sh-amber/45 hover:bg-sh-amber/22'
        : tone === 'mint'
          ? 'bg-sh-mint/12 text-sh-mint border border-sh-mint/45 hover:bg-sh-mint/22'
          : tone === 'grey'
            ? 'bg-sh-grey/12 text-sh-muted border border-sh-border hover:bg-sh-grey/20'
            : 'bg-sh-surface-hi border border-sh-border hover:border-sh-lilac/60';

  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`rounded-lg px-2.5 py-2 text-xs font-semibold transition disabled:opacity-40 ${cls}`}
    >
      {busy ? '…' : children}
    </button>
  );
}
