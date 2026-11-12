import { supabase } from './supabase';
import { RPC, TABLES } from '@safeher/shared';
import type { Incident, IncidentStatus, NearestUnit } from '@safeher/shared';

/**
 * Every state change an operator can make.
 *
 * None of these writes a timeline row by hand — the trigger in
 * 0002_functions.sql does that from the database side, so a mutation
 * that forgot to log itself is not possible.
 */

export async function setStatus(
  incidentId: string,
  status: IncidentStatus,
  note?: string,
): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { status };
  if (note !== undefined) patch.resolution_note = note;
  const { error } = await supabase.from(TABLES.incidents).update(patch).eq('id', incidentId);
  return { error: error?.message ?? null };
}

export async function acknowledge(incidentId: string, responderId: string) {
  const { error } = await supabase
    .from(TABLES.incidents)
    .update({ status: 'acknowledged', assigned_responder_id: responderId })
    .eq('id', incidentId);
  return { error: error?.message ?? null };
}

export async function assignUnit(incidentId: string, unitId: string) {
  const { error } = await supabase
    .from(TABLES.incidents)
    .update({ assigned_unit_id: unitId, status: 'assigned' })
    .eq('id', incidentId);
  if (!error) {
    await supabase.from(TABLES.units).update({ status: 'dispatched' }).eq('id', unitId);
  }
  return { error: error?.message ?? null };
}

export async function nearestUnits(
  lat: number,
  lng: number,
  kind?: 'patrol' | 'ambulance' | 'bike',
): Promise<NearestUnit[]> {
  const { data } = await supabase.rpc(RPC.nearestUnits, {
    p_lat: lat,
    p_lng: lng,
    p_kind: kind ?? null,
    p_limit: 8,
  });
  return (data ?? []) as NearestUnit[];
}

export async function reassignStation(incidentId: string, stationId: string, reason: string) {
  const { data, error } = await supabase.rpc(RPC.reassignStation, {
    p_incident_id: incidentId,
    p_station_id: stationId,
    p_reason: reason,
  });
  return { incident: data as Incident | null, error: error?.message ?? null };
}

/** Both directions must work — a road accident needs police and an ambulance. */
export async function crossDispatch(incidentId: string, want: 'police' | 'medical') {
  const { data, error } = await supabase.rpc(RPC.requestCrossDispatch, {
    p_incident_id: incidentId,
    p_want: want,
  });
  return { incident: data as Incident | null, error: error?.message ?? null };
}

export async function sendText(incidentId: string, senderId: string, body: string) {
  if (!body.trim()) return { error: null };
  const { error } = await supabase.from(TABLES.incidentMessages).insert({
    incident_id: incidentId,
    sender_role: 'responder',
    sender_id: senderId,
    body: body.trim(),
  });
  if (!error) {
    await supabase.from(TABLES.incidentEvents).insert({
      incident_id: incidentId,
      actor_type: 'responder',
      actor_id: senderId,
      kind: 'sos.message',
      message: body.trim().slice(0, 200),
    });
  }
  return { error: error?.message ?? null };
}
