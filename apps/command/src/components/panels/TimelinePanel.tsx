import { formatClock } from '@safeher/shared';
import type { IncidentEvent } from '@safeher/shared';
import { Panel } from '../DetailPane';

/**
 * The audit timeline.
 *
 * Generated entirely from incident_events, never hand-written. That is
 * the difference between a demo and something a department would trust:
 * if it is on this list it is a row in an append-only table, and if it
 * is not on this list it did not happen.
 */
const ACTOR = {
  system: { label: 'SYSTEM', cls: 'bg-sh-grey/25 text-sh-muted' },
  citizen: { label: 'CITIZEN', cls: 'bg-sh-rose/25 text-sh-rose' },
  guardian: { label: 'GUARDIAN', cls: 'bg-sh-lilac/25 text-sh-lilac' },
  responder: { label: 'RESPONDER', cls: 'bg-sh-sky/25 text-sh-sky' },
} as const;

export default function TimelinePanel({ events }: { events: IncidentEvent[] }) {
  return (
    <Panel title={`Timeline · ${events.length} events`} defaultOpen={false}>
      <ol className="space-y-0">
        {events.map((e, idx) => {
          const a = ACTOR[e.actor_type] ?? ACTOR.system;
          const last = idx === events.length - 1;
          return (
            <li key={e.id} className="flex gap-2.5">
              <div className="flex flex-col items-center shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-sh-lilac mt-1.5" />
                {!last && <span className="w-px flex-1 bg-sh-border" />}
              </div>
              <div className="pb-2.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[8px] font-extrabold tracking-wider px-1 py-0.5 rounded ${a.cls}`}>
                    {a.label}
                  </span>
                  <span className="tabular text-[10px] text-sh-faint">{formatClock(e.at)}</span>
                  <span className="text-[10px] font-mono text-sh-lilac">{e.kind}</span>
                </div>
                {e.message && (
                  <p className="text-[11px] text-sh-muted leading-snug mt-0.5 break-words">
                    {e.message}
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {events.length === 0 && <li className="text-xs text-sh-faint">No events yet.</li>}
      </ol>
    </Panel>
  );
}
