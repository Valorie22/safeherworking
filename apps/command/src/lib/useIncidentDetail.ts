import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { TABLES, CHANNELS } from '@safeher/shared';
import type {
  Hospital,
  IncidentEvent,
  IncidentLocation,
  IncidentMedia,
  IncidentMessage,
  PoliceStation,
  Profile,
  Responder,
  Unit,
} from '@safeher/shared';

export interface IncidentDetail {
  locations: IncidentLocation[];
  media: IncidentMedia[];
  events: IncidentEvent[];
  messages: IncidentMessage[];
  profile: Profile | null;
  station: PoliceStation | null;
  hospital: Hospital | null;
  unit: Unit | null;
  responder: Responder | null;
  loading: boolean;
}

const EMPTY: IncidentDetail = {
  locations: [],
  media: [],
  events: [],
  messages: [],
  profile: null,
  station: null,
  hospital: null,
  unit: null,
  responder: null,
  loading: true,
};

/**
 * Everything attached to one incident, kept live.
 *
 * Subscribes to incident:{id}. Breadcrumbs, media, timeline rows and
 * messages all arrive as postgres_changes, so the officer watches the
 * victim move rather than clicking refresh.
 */
export function useIncidentDetail(
  incidentId: string | null,
  ids: {
    userId?: string | null;
    stationId?: string | null;
    hospitalId?: string | null;
    unitId?: string | null;
    responderId?: string | null;
  },
) {
  const [d, setD] = useState<IncidentDetail>(EMPTY);

  // Child collections + realtime.
  useEffect(() => {
    if (!incidentId) {
      setD(EMPTY);
      return;
    }
    let alive = true;
    setD((p) => ({ ...p, loading: true }));

    async function loadAll() {
      const [loc, med, ev, msg] = await Promise.all([
        supabase
          .from(TABLES.incidentLocations)
          .select('*')
          .eq('incident_id', incidentId)
          .order('captured_at'),
        supabase
          .from(TABLES.incidentMedia)
          .select('*')
          .eq('incident_id', incidentId)
          .order('captured_at'),
        supabase
          .from(TABLES.incidentEvents)
          .select('*')
          .eq('incident_id', incidentId)
          .order('at'),
        supabase
          .from(TABLES.incidentMessages)
          .select('*')
          .eq('incident_id', incidentId)
          .order('at'),
      ]);
      if (!alive) return;
      setD((p) => ({
        ...p,
        locations: (loc.data ?? []) as IncidentLocation[],
        media: (med.data ?? []) as IncidentMedia[],
        events: (ev.data ?? []) as IncidentEvent[],
        messages: (msg.data ?? []) as IncidentMessage[],
        loading: false,
      }));
    }
    loadAll();

    const ch = supabase
      .channel(CHANNELS.incident(incidentId))
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLES.incidentLocations,
          filter: `incident_id=eq.${incidentId}`,
        },
        (p) =>
          setD((prev) => ({
            ...prev,
            locations: [...prev.locations, p.new as IncidentLocation],
          })),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLES.incidentMedia,
          filter: `incident_id=eq.${incidentId}`,
        },
        (p) => setD((prev) => ({ ...prev, media: [...prev.media, p.new as IncidentMedia] })),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLES.incidentEvents,
          filter: `incident_id=eq.${incidentId}`,
        },
        (p) => setD((prev) => ({ ...prev, events: [...prev.events, p.new as IncidentEvent] })),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLES.incidentMessages,
          filter: `incident_id=eq.${incidentId}`,
        },
        (p) =>
          setD((prev) => ({ ...prev, messages: [...prev.messages, p.new as IncidentMessage] })),
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [incidentId]);

  // Related rows. Cheap, and they change rarely.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [prof, st, hosp, unit, resp] = await Promise.all([
        ids.userId
          ? supabase.from(TABLES.profiles).select('*').eq('id', ids.userId).maybeSingle()
          : Promise.resolve({ data: null }),
        ids.stationId
          ? supabase.from(TABLES.policeStations).select('*').eq('id', ids.stationId).maybeSingle()
          : Promise.resolve({ data: null }),
        ids.hospitalId
          ? supabase.from(TABLES.hospitals).select('*').eq('id', ids.hospitalId).maybeSingle()
          : Promise.resolve({ data: null }),
        ids.unitId
          ? supabase.from(TABLES.units).select('*').eq('id', ids.unitId).maybeSingle()
          : Promise.resolve({ data: null }),
        ids.responderId
          ? supabase.from(TABLES.responders).select('*').eq('id', ids.responderId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!alive) return;
      setD((p) => ({
        ...p,
        profile: (prof.data as Profile) ?? null,
        station: (st.data as PoliceStation) ?? null,
        hospital: (hosp.data as Hospital) ?? null,
        unit: (unit.data as Unit) ?? null,
        responder: (resp.data as Responder) ?? null,
      }));
    })();
    return () => {
      alive = false;
    };
  }, [ids.userId, ids.stationId, ids.hospitalId, ids.unitId, ids.responderId]);

  return d;
}
