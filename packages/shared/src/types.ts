/**
 * SafeHer — TypeScript types for every table in 0001_schema.sql.
 *
 * Kept hand-written rather than generated so the comments explaining
 * *why* a field exists travel with it. If you change the schema, change
 * this file in the same commit.
 */

export type IncidentType = 'safety' | 'medical';

export type TriggerReason =
  | 'manual'
  | 'shake'
  | 'duress'
  | 'acoustic'
  | 'journey'
  | 'battery'
  | 'medical_manual'
  | 'fall';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus =
  | 'new'
  | 'acknowledged'
  | 'assigned'
  | 'dispatched'
  | 'enroute'
  | 'onscene'
  | 'resolved'
  | 'false_alarm';

export type ResponderRole =
  | 'dispatcher'
  | 'officer'
  | 'supervisor'
  | 'medic'
  | 'paramedic';

export type UnitKind = 'patrol' | 'ambulance' | 'bike';
export type UnitStatus = 'available' | 'dispatched' | 'enroute' | 'onscene' | 'offline';
export type ActorType = 'system' | 'citizen' | 'guardian' | 'responder';
export type SenderRole = 'citizen' | 'guardian' | 'responder';
export type GuardianStatus = 'pending' | 'active' | 'revoked';
export type JourneyState = 'running' | 'overdue' | 'breached' | 'completed';
export type MediaKind = 'audio' | 'photo' | 'video';

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  photo_url: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address: string | null;
  // the medical record that travels with every SOS
  blood_group: string | null;
  allergies: string[] | null;
  conditions: string[] | null;
  medications: string[] | null;
  emergency_note: string | null;
  organ_donor: boolean;
  created_at: string;
}

export interface Guardian {
  id: string;
  user_id: string;
  linked_profile_id: string | null;
  name: string;
  phone: string;
  relation: string | null;
  tier: 1 | 2 | 3;
  can_view_live: boolean;
  invite_code: string | null;
  status: GuardianStatus;
  created_at: string;
}

export interface PoliceStation {
  id: string;
  name: string;
  code: string | null;
  district: string | null;
  state: string | null;
  lat: number;
  lng: number;
  control_room_phone: string | null;
  jurisdiction_radius_m: number;
}

export interface Hospital {
  id: string;
  name: string;
  type: string | null;
  lat: number;
  lng: number;
  has_ambulance: boolean;
  has_trauma_unit: boolean;
  beds_available: number;
}

export interface Responder {
  id: string;
  full_name: string;
  badge_no: string | null;
  role: ResponderRole;
  station_id: string | null;
  hospital_id: string | null;
  on_duty: boolean;
}

export interface Unit {
  id: string;
  callsign: string;
  kind: UnitKind | null;
  station_id: string | null;
  hospital_id: string | null;
  status: UnitStatus;
  lat: number | null;
  lng: number | null;
  updated_at: string;
}

/**
 * The frozen medical record. Written once by raise_sos() and never
 * updated — if the citizen edits their profile tomorrow, the incident
 * still shows what responders were actually told at the time.
 */
export interface MedicalSnapshot {
  frozen_at: string;
  full_name: string;
  phone: string;
  photo_url: string | null;
  date_of_birth: string | null;
  age: number | null;
  gender: string | null;
  address: string | null;
  blood_group: string | null;
  allergies: string[];
  conditions: string[];
  medications: string[];
  emergency_note: string | null;
  organ_donor: boolean;
}

export interface Incident {
  id: string;
  public_ref: string;
  user_id: string;
  type: IncidentType;
  trigger_reason: string;
  severity: Severity;
  status: IncidentStatus;
  silent: boolean;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  assigned_station_id: string | null;
  assigned_hospital_id: string | null;
  assigned_responder_id: string | null;
  assigned_unit_id: string | null;
  routing_distance_m: number | null;
  medical_snapshot: MedicalSnapshot | null;
  created_at: string;
  acknowledged_at: string | null;
  dispatched_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface IncidentLocation {
  id: number;
  incident_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  captured_at: string;
}

export interface IncidentMedia {
  id: string;
  incident_id: string;
  kind: MediaKind;
  storage_path: string;
  duration_ms: number | null;
  captured_at: string;
  /** TRUE = sealed from the rolling buffer, i.e. captured BEFORE the press. */
  before_trigger: boolean;
  uploaded_at: string;
}

export interface IncidentEvent {
  id: number;
  incident_id: string;
  actor_type: ActorType;
  actor_id: string | null;
  kind: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  at: string;
}

export interface IncidentMessage {
  id: string;
  incident_id: string;
  sender_role: SenderRole;
  sender_id: string | null;
  body: string | null;
  audio_path: string | null;
  at: string;
}

export interface Journey {
  id: string;
  user_id: string;
  label: string | null;
  destination: string | null;
  eta_minutes: number | null;
  interval_seconds: number;
  next_checkin_at: string;
  state: JourneyState;
  started_at: string;
  ended_at: string | null;
}

// --- RPC return shapes -------------------------------------------------

export interface NearestStation {
  id: string;
  name: string;
  code: string | null;
  distance_m: number;
  lat: number;
  lng: number;
}

export interface NearestHospital {
  id: string;
  name: string;
  type: string | null;
  distance_m: number;
  has_trauma_unit: boolean;
  lat: number;
  lng: number;
}

export interface NearestUnit {
  id: string;
  callsign: string;
  kind: UnitKind;
  status: UnitStatus;
  distance_m: number | null;
  lat: number | null;
  lng: number | null;
}

/**
 * The payload of the `routing.resolved` event. This is what lets the
 * dashboard answer "why this station?" instead of just asserting it.
 */
export interface RoutingResolvedPayload {
  stations: NearestStation[];
  hospitals: NearestHospital[];
  chosen_station_id: string | null;
  chosen_hospital_id: string | null;
  routing_distance_m: number | null;
  resolved_in_ms?: number;
  reason?: string;
}

export interface RaiseSosArgs {
  p_type: IncidentType;
  p_trigger_reason: TriggerReason | string;
  p_lat?: number | null;
  p_lng?: number | null;
  p_accuracy_m?: number | null;
  p_silent?: boolean;
  p_severity?: Severity;
  p_location_stale?: boolean;
}

/** An incident joined with the citizen's live profile, as the dashboard uses it. */
export interface IncidentWithProfile extends Incident {
  profile?: Profile | null;
  station?: PoliceStation | null;
  hospital?: Hospital | null;
  unit?: Unit | null;
}
