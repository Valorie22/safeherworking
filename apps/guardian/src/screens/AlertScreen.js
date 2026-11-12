import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { supabase } from '../lib/supabase';
import { COLORS, S, statusTone } from '../lib/ui';
import TrailMap from '../components/TrailMap';
import {
  CHANNELS,
  EVENTS,
  TABLES,
  formatClock,
  formatDistance,
  statusLabel,
  triggerLabel,
} from '@safeher/shared';

/**
 * The ALERT screen.
 *
 * Takes over the entire app the instant an SOS arrives for a ward.
 * Full bleed, unmissable, sound and vibration.
 *
 * Three actions, and the second one is the app's killer feature:
 *   1. I'm responding      -> guardian.acknowledged
 *   2. Add context         -> guardian.context, straight into the
 *                             officer's panel. "She was walking to the
 *                             metro from the east gate" is worth more to
 *                             a dispatcher than any sensor on the phone.
 *   3. Push to talk        -> the same conversation as everyone else.
 *
 * A guardian can NEVER resolve or cancel an incident. Only the citizen
 * or a responder can — enforced in RLS, not just hidden here.
 */
export default function AlertScreen({ incident: initial, ward, session, onCleared }) {
  const [incident, setIncident] = useState(initial);
  const [locations, setLocations] = useState([]);
  const [media, setMedia] = useState([]);
  const [place, setPlace] = useState(null);
  const [context, setContext] = useState('');
  const [acked, setAcked] = useState(false);
  const [recording, setRecording] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState(null);

  const recRef = useRef(null);
  const pttStart = useRef(0);
  const playedRef = useRef(new Set());

  const medical = incident.type === 'medical';
  const tint = medical ? COLORS.amber : COLORS.rose;

  // --- make it impossible to miss ---
  useEffect(() => {
    // A repeating pattern, not a single buzz. A phone face-down on a
    // kitchen table has to be able to interrupt someone.
    Vibration.vibrate([0, 600, 400, 600, 400, 600], true);
    return () => Vibration.cancel();
  }, []);

  // --- live feed for this incident ---
  useEffect(() => {
    async function load() {
      // Re-read the incident before anything else.
      //
      // raise_sos() INSERTs the row and then UPDATEs it with the routing
      // decision. Realtime delivers the INSERT first, so the row this
      // screen was handed still has assigned_station_id = null — and the
      // UPDATE often lands before this screen has finished subscribing.
      // Without this refetch the parent is told "Resolving…" forever,
      // which is the one thing they most need to know.
      const { data: fresh } = await supabase
        .from(TABLES.incidents)
        .select('*')
        .eq('id', incident.id)
        .maybeSingle();
      if (fresh) setIncident((prev) => ({ ...prev, ...fresh }));

      const [loc, med] = await Promise.all([
        supabase
          .from(TABLES.incidentLocations)
          .select('*')
          .eq('incident_id', incident.id)
          .order('captured_at'),
        supabase
          .from(TABLES.incidentMedia)
          .select('*')
          .eq('incident_id', incident.id)
          .order('captured_at', { ascending: false }),
      ]);
      setLocations(loc.data ?? []);
      setMedia(med.data ?? []);
    }
    load();

    const ch = supabase
      .channel(CHANNELS.incident(incident.id))
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLES.incidentLocations,
          filter: `incident_id=eq.${incident.id}`,
        },
        (p) => setLocations((prev) => [...prev, p.new]),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLES.incidentMedia,
          filter: `incident_id=eq.${incident.id}`,
        },
        (p) => setMedia((prev) => [p.new, ...prev]),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: TABLES.incidents,
          filter: `id=eq.${incident.id}`,
        },
        (p) => {
          setIncident((prev) => ({ ...prev, ...p.new }));
          if (p.new.status === 'resolved' || p.new.status === 'false_alarm') {
            Vibration.cancel();
            onCleared();
          }
        },
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident.id]);

  // --- where it was routed ---
  useEffect(() => {
    (async () => {
      if (medical && incident.assigned_hospital_id) {
        const { data } = await supabase
          .from(TABLES.hospitals)
          .select('name')
          .eq('id', incident.assigned_hospital_id)
          .maybeSingle();
        setPlace(data?.name ?? null);
      } else if (incident.assigned_station_id) {
        const { data } = await supabase
          .from(TABLES.policeStations)
          .select('name')
          .eq('id', incident.assigned_station_id)
          .maybeSingle();
        setPlace(data?.name ?? null);
      }
    })();
  }, [incident.assigned_station_id, incident.assigned_hospital_id, medical]);

  // --- latest snapshot ---
  useEffect(() => {
    const photo = media.find((m) => m.kind === 'photo');
    if (!photo) return;
    supabase.storage
      .from('incident-media')
      .createSignedUrl(photo.storage_path, 3600)
      .then(({ data }) => setSnapshotUrl(data?.signedUrl ?? null));
  }, [media]);

  // --- play incoming audio, newest first ---
  useEffect(() => {
    const clip = media.find(
      (m) => m.kind === 'audio' && !m.before_trigger && !playedRef.current.has(m.id),
    );
    if (!clip) return;
    playedRef.current.add(clip.id);
    (async () => {
      const { data } = await supabase.storage
        .from('incident-media')
        .createSignedUrl(clip.storage_path, 3600);
      if (!data?.signedUrl) return;
      try {
        const { sound } = await Audio.Sound.createAsync({ uri: data.signedUrl });
        await sound.playAsync();
      } catch {
        /* ignore */
      }
    })();
  }, [media]);

  async function respond() {
    setAcked(true);
    Vibration.cancel();
    await supabase.from(TABLES.incidentEvents).insert({
      incident_id: incident.id,
      actor_type: 'guardian',
      actor_id: session.user.id,
      kind: EVENTS.GUARDIAN_ACKNOWLEDGED,
      message: `${ward?.full_name ? ward.full_name + "'s " : ''}guardian is responding`,
      payload: { guardian_id: session.user.id },
    });
  }

  async function sendContext() {
    const body = context.trim();
    if (!body) return;
    setContext('');

    // Two writes on purpose: the message joins the conversation, and the
    // event makes it visually distinct in the officer's comms panel as
    // family context rather than as the victim speaking.
    await supabase.from(TABLES.incidentMessages).insert({
      incident_id: incident.id,
      sender_role: 'guardian',
      sender_id: session.user.id,
      body,
    });
    await supabase.from(TABLES.incidentEvents).insert({
      incident_id: incident.id,
      actor_type: 'guardian',
      actor_id: session.user.id,
      kind: EVENTS.GUARDIAN_CONTEXT,
      message: body,
      payload: { from: 'guardian' },
    });
    Alert.alert('Sent', 'The control room can see that now.');
  }

  async function startPtt() {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recRef.current = rec;
      pttStart.current = Date.now();
      setRecording(true);
    } catch {
      /* ignore */
    }
  }

  async function stopPtt() {
    const rec = recRef.current;
    if (!rec) return;
    setRecording(false);
    recRef.current = null;
    const durationMs = Date.now() - pttStart.current;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri || durationMs < 300) return;

      const path = `${incident.id}/ptt/${Date.now()}.m4a`;
      const res = await fetch(uri);
      const bytes = await res.arrayBuffer();
      const { error } = await supabase.storage
        .from('incident-media')
        .upload(path, bytes, { contentType: 'audio/m4a', upsert: true });
      if (error) return;

      await supabase.from(TABLES.incidentMessages).insert({
        incident_id: incident.id,
        sender_role: 'guardian',
        sender_id: session.user.id,
        audio_path: path,
      });
    } catch {
      /* ignore */
    }
  }

  const snap = incident.medical_snapshot;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      contentContainerStyle={{ paddingBottom: 48 }}
    >
      {/* Full-bleed header */}
      <View
        style={{
          backgroundColor: tint,
          paddingTop: 58,
          paddingBottom: 22,
          paddingHorizontal: 22,
        }}
      >
        <Text
          style={{
            color: medical ? '#231400' : '#2A0413',
            fontSize: 13,
            fontWeight: '900',
            letterSpacing: 3,
          }}
        >
          {medical ? 'MEDICAL EMERGENCY' : 'SAFETY EMERGENCY'}
        </Text>
        <Text
          style={{
            color: medical ? '#231400' : '#2A0413',
            fontSize: 38,
            fontWeight: '900',
            marginTop: 4,
          }}
        >
          {ward?.full_name ?? snap?.full_name ?? 'Your ward'}
        </Text>
        <Text style={{ color: medical ? '#231400' : '#2A0413', opacity: 0.85, marginTop: 2 }}>
          {triggerLabel(incident.trigger_reason)} · {formatClock(incident.created_at)} ·{' '}
          {incident.public_ref}
        </Text>
      </View>

      {/* Status from the control room */}
      <View style={[S.pad, { marginTop: 18 }]}>
        <View style={[S.row, { gap: 8 }]}>
          <View
            style={[
              S.pill,
              {
                borderColor: statusTone(incident.status),
                backgroundColor: statusTone(incident.status) + '22',
              },
            ]}
          >
            <Text style={[S.pillText, { color: statusTone(incident.status) }]}>
              {statusLabel(incident.status)}
            </Text>
          </View>
          <Text style={S.small}>
            {incident.status === 'new'
              ? 'the control room has not opened it yet'
              : 'the control room is on it'}
          </Text>
        </View>
      </View>

      {/* Live trail */}
      <View style={[S.pad, { marginTop: 16 }]}>
        <Text style={S.label}>Live location</Text>
        <View style={{ marginTop: 8 }}>
          <TrailMap
            points={
              incident.lat != null
                ? [{ lat: incident.lat, lng: incident.lng, id: 'origin' }, ...locations]
                : locations
            }
            tint={tint}
          />
        </View>
      </View>

      {/* Routing */}
      <View style={[S.pad, { marginTop: 16 }]}>
        <Text style={S.label}>Help routed to</Text>
        <View style={[S.card, { marginTop: 8, borderColor: tint }]}>
          <Text style={[S.h2, { color: tint }]}>{place ?? 'Resolving…'}</Text>
          <Text style={S.body}>
            {formatDistance(incident.routing_distance_m)} away · chosen automatically
          </Text>
        </View>
      </View>

      {/* Medical — visible ONLY while the incident is live. Once it is
          resolved, RLS stops returning this row at all. */}
      {snap && (
        <View style={[S.pad, { marginTop: 16 }]}>
          <Text style={S.label}>Medical record</Text>
          <View style={[S.card, { marginTop: 8 }]}>
            <Text style={{ color: COLORS.amber, fontSize: 34, fontWeight: '900' }}>
              {snap.blood_group ?? '—'}
            </Text>
            {snap.allergies?.length ? (
              <Text style={[S.body, { marginTop: 4 }]}>
                Allergies: {snap.allergies.join(', ')}
              </Text>
            ) : null}
            {snap.conditions?.length ? (
              <Text style={S.body}>Conditions: {snap.conditions.join(', ')}</Text>
            ) : null}
            <Text style={[S.small, { marginTop: 8 }]}>
              You can see this because an emergency is open. It disappears when it closes —
              SafeHer Circle is not a surveillance tool.
            </Text>
          </View>
        </View>
      )}

      {/* Latest snapshot */}
      {snapshotUrl && (
        <View style={[S.pad, { marginTop: 16 }]}>
          <Text style={S.label}>Latest snapshot</Text>
          <Image
            source={{ uri: snapshotUrl }}
            style={{
              width: '100%',
              height: 190,
              borderRadius: 16,
              marginTop: 8,
              borderWidth: 1,
              borderColor: COLORS.border,
            }}
          />
        </View>
      )}

      {/* --- the three actions --- */}
      <View style={[S.pad, { marginTop: 24, gap: 12 }]}>
        <Pressable
          onPress={respond}
          disabled={acked}
          style={[
            S.btn,
            {
              backgroundColor: acked ? COLORS.surfaceAlt : COLORS.mint,
              borderWidth: 1,
              borderColor: COLORS.mint,
            },
          ]}
        >
          <Text style={[S.btnText, { color: acked ? COLORS.mint : '#062419' }]}>
            {acked ? "✓ They know you're coming" : "I'm responding"}
          </Text>
        </Pressable>

        <View style={[S.card, { borderColor: COLORS.lilac }]}>
          <Text style={[S.label, { color: COLORS.lilac }]}>Add context</Text>
          <Text style={[S.small, { marginTop: 2 }]}>
            Anything you know that the phone cannot tell them.
          </Text>
          <TextInput
            value={context}
            onChangeText={setContext}
            multiline
            placeholder="She was walking to the metro from the east gate…"
            placeholderTextColor={COLORS.textFaint}
            style={[S.input, { marginTop: 10, minHeight: 78 }]}
          />
          <Pressable
            style={[S.btn, { marginTop: 10, backgroundColor: COLORS.lilac }]}
            onPress={sendContext}
          >
            <Text style={[S.btnText, { color: '#1A0620' }]}>Send to the control room</Text>
          </Pressable>
        </View>

        <Pressable
          onPressIn={startPtt}
          onPressOut={stopPtt}
          style={[
            S.btn,
            {
              backgroundColor: recording ? COLORS.rose : 'rgba(255,77,141,0.14)',
              borderWidth: 2,
              borderColor: COLORS.rose,
            },
          ]}
        >
          <Text style={[S.btnText, { color: recording ? COLORS.onAccent : COLORS.rose }]}>
            {recording ? '● RELEASE TO SEND' : 'HOLD TO TALK'}
          </Text>
        </Pressable>

        <Text style={[S.small, { textAlign: 'center', marginTop: 6 }]}>
          Only {ward?.full_name ?? 'she'} or a responder can close this alert.
        </Text>
      </View>
    </ScrollView>
  );
}
