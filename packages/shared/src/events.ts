/**
 * SafeHer — channels and event names (§3.4).
 *
 * This file is the reason the four apps stay in sync. If the citizen app
 * publishes `sos.created` and the dashboard listens for `sos_created`,
 * nothing syncs and the entire demo is dead. So nobody types these
 * strings by hand anywhere — they import from here.
 *
 * `incident_events.kind` uses these same strings. One vocabulary, not two.
 */

export const CHANNELS = {
  /** Command, scoped to one officer's station. */
  station: (stationId: string) => `station:${stationId}`,
  /** Med, scoped to one hospital. */
  medical: (hospitalId: string) => `medical:${hospitalId}`,
  /** The city-wide supervisor wall. */
  commandAll: 'command:all',
  /** The live feed for one incident: citizen + guardians + assigned responders. */
  incident: (incidentId: string) => `incident:${incidentId}`,
  /** A user's own lifecycle, watched by their active guardians. */
  user: (userId: string) => `user:${userId}`,
} as const;

export const EVENTS = {
  // --- lifecycle ---
  SOS_CREATED: 'sos.created',
  SOS_LOCATION: 'sos.location',
  SOS_MEDIA: 'sos.media',
  SOS_MEDICAL_SNAPSHOT: 'sos.medical_snapshot',
  ROUTING_RESOLVED: 'routing.resolved',
  SOS_ACKNOWLEDGED: 'sos.acknowledged',
  SOS_ASSIGNED: 'sos.assigned',
  SOS_UNIT_DISPATCHED: 'sos.unit_dispatched',
  SOS_STATUS: 'sos.status',
  SOS_MESSAGE: 'sos.message',
  SOS_RESOLVED: 'sos.resolved',
  SOS_FALSE_ALARM: 'sos.false_alarm',

  // --- guardian ---
  GUARDIAN_ACKNOWLEDGED: 'guardian.acknowledged',
  GUARDIAN_CONTEXT: 'guardian.context',

  // --- journeys (dead-man's switch) ---
  JOURNEY_STARTED: 'journey.started',
  JOURNEY_CHECKIN: 'journey.checkin',
  JOURNEY_OVERDUE: 'journey.overdue',
  JOURNEY_BREACHED: 'journey.breached',

  // --- comms ---
  COMM_PTT: 'comm.ptt',
  COMM_CALL_OFFER: 'comm.call.offer',
  COMM_CALL_ANSWER: 'comm.call.answer',
  COMM_CALL_ICE: 'comm.call.ice',
} as const;

export type EventKind = (typeof EVENTS)[keyof typeof EVENTS];

/** Table names, imported rather than typed, for the same reason. */
export const TABLES = {
  profiles: 'profiles',
  guardians: 'guardians',
  policeStations: 'police_stations',
  hospitals: 'hospitals',
  responders: 'responders',
  units: 'units',
  incidents: 'incidents',
  incidentLocations: 'incident_locations',
  incidentMedia: 'incident_media',
  incidentEvents: 'incident_events',
  incidentMessages: 'incident_messages',
  journeys: 'journeys',
  // read-only views used by the guardian app
  wardProfiles: 'ward_profiles',
  guardianIncidentHistory: 'guardian_incident_history',
} as const;

export const RPC = {
  raiseSos: 'raise_sos',
  nearestStations: 'nearest_stations',
  nearestHospitals: 'nearest_hospitals',
  nearestUnits: 'nearest_units',
  reassignStation: 'reassign_station',
  requestCrossDispatch: 'request_cross_dispatch',
  journeyCheckin: 'journey_checkin',
} as const;

export const BUCKETS = {
  incidentMedia: 'incident-media',
  avatars: 'avatars',
} as const;

/** Every broadcast payload carries these. Specific fields are added on top. */
export interface BasePayload {
  incident_id: string;
  at: string;
  actor: 'system' | 'citizen' | 'guardian' | 'responder';
}

/**
 * Storage paths. The first segment must be the incident id — the storage
 * RLS policies in 0004_storage.sql parse it to decide who may read the
 * object, so a path built any other way will be silently unreadable.
 */
export const mediaPath = {
  audio: (incidentId: string, capturedAtMs: number, beforeTrigger = false) =>
    `${incidentId}/audio/${beforeTrigger ? 'pre-' : ''}${capturedAtMs}.m4a`,
  photo: (incidentId: string, capturedAtMs: number) =>
    `${incidentId}/photo/${capturedAtMs}.jpg`,
  ptt: (incidentId: string, capturedAtMs: number) =>
    `${incidentId}/ptt/${capturedAtMs}.m4a`,
};
