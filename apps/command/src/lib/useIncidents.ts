import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { TABLES } from '@safeher/shared';
import type { Incident, IncidentWithProfile, Profile, Responder } from '@safeher/shared';

export type ConnState = 'connecting' | 'live' | 'dropped';

interface Options {
  responder: Responder | null;
  /** /med only ever shows type='medical'. Command only ever shows safety. */
  medical: boolean;
}

/**
 * The live incident queue.
 *
 * Two things here are load-bearing:
 *
 * 1. A control room that silently stops receiving alerts is worse than no
 *    control room. So when the realtime socket drops we say so loudly AND
 *    start polling every 3 seconds, and we keep polling until the socket
 *    is genuinely back.
 *
 * 2. The filter is applied server-side by RLS as well as here. This hook
 *    narrowing to one station is a convenience; it is not the security
 *    boundary.
 */
export function useIncidents({ responder, medical }: Options) {
  const [incidents, setIncidents] = useState<IncidentWithProfile[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [lastSync, setLastSync] = useState<number>(Date.now());
  const profiles = useRef<Map<string, Profile>>(new Map());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const hydrateProfiles = useCallback(async (rows: Incident[]) => {
    const missing = [...new Set(rows.map((r) => r.user_id))].filter(
      (id) => !profiles.current.has(id),
    );
    if (missing.length === 0) return;
    const { data } = await supabase.from(TABLES.profiles).select('*').in('id', missing);
    for (const p of (data ?? []) as Profile[]) profiles.current.set(p.id, p);
  }, []);

  const withProfile = useCallback(
    (rows: Incident[]): IncidentWithProfile[] =>
      rows.map((r) => ({ ...r, profile: profiles.current.get(r.user_id) ?? null })),
    [],
  );

  const fetchAll = useCallback(async () => {
    if (!responder) return;
    let q = supabase
      .from(TABLES.incidents)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (medical) {
      q = q.eq('type', 'medical');
      if (responder.hospital_id) q = q.eq('assigned_hospital_id', responder.hospital_id);
    } else if (responder.role !== 'supervisor') {
      // An officer sees their station. A supervisor sees the city wall.
      if (responder.station_id) q = q.eq('assigned_station_id', responder.station_id);
    }

    const { data, error } = await q;
    if (error) return;
    const rows = (data ?? []) as Incident[];
    await hydrateProfiles(rows);
    setIncidents(withProfile(rows));
    setLastSync(Date.now());
  }, [responder, medical, hydrateProfiles, withProfile]);

  // Initial load + realtime subscription.
  useEffect(() => {
    if (!responder) return;
    let alive = true;
    fetchAll();

    const channelName = medical
      ? `med-wall:${responder.hospital_id ?? 'all'}`
      : responder.role === 'supervisor'
        ? 'command:all'
        : `station-wall:${responder.station_id ?? 'none'}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLES.incidents },
        async (payload) => {
          if (!alive) return;
          setLastSync(Date.now());

          if (payload.eventType === 'DELETE') {
            setIncidents((prev) => prev.filter((i) => i.id !== (payload.old as Incident).id));
            return;
          }

          const row = payload.new as Incident;
          // RLS already decided we may see it; this is the view filter.
          if (medical && row.type !== 'medical') return;
          if (!medical && row.type === 'medical' && responder.role !== 'supervisor') return;

          await hydrateProfiles([row]);
          setIncidents((prev) => {
            const next = prev.filter((i) => i.id !== row.id);
            return withProfile([row, ...next.map((n) => n as Incident)]).sort(
              (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
            );
          });
        },
      )
      .subscribe((status) => {
        if (!alive) return;
        if (status === 'SUBSCRIBED') {
          setConn('live');
          // Catch anything that happened while we were reconnecting.
          fetchAll();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConn('dropped');
        }
      });

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [responder, medical, fetchAll, hydrateProfiles, withProfile]);

  // Degrade, never dead-end: poll while the socket is down.
  useEffect(() => {
    if (conn === 'dropped') {
      if (!pollTimer.current) {
        pollTimer.current = setInterval(fetchAll, 3000);
      }
    } else if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [conn, fetchAll]);

  return { incidents, conn, lastSync, refetch: fetchAll };
}
