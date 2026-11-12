import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Vibration,
} from 'react-native';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../lib/supabase';
import { COLORS, S, statusTone } from '../lib/ui';
import {
  resolveIncident,
  sendMessage,
  sendPtt,
  startIncidentStreaming,
} from '../lib/sos';
import {
  CHANNELS,
  TABLES,
  formatClock,
  formatDistance,
  statusLabel,
  triggerLabel,
} from '@safeher/shared';

/**
 * Once an SOS fires, the app becomes this screen. There is nothing else
 * to do and nothing else to look at.
 *
 * SILENT MODE: when incident.silent is true this screen renders as the
 * calculator instead (handled by App.js), and everything below —
 * vibration, auto-play, the camera — is suppressed. An officer's voice
 * coming out of a hidden phone is a safety failure.
 */
export default function ActiveIncident({ incident: initial, session, onResolved }) {
  const [incident, setIncident] = useState(initial);
  const [messages, setMessages] = useState([]);
  const [place, setPlace] = useState(null);
  const [responder, setResponder] = useState(null);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);

  const cameraRef = useRef(null);
  const recRef = useRef(null);
  const pttStart = useRef(0);
  const playedRef = useRef(new Set());
  const [camPerm, requestCam] = useCameraPermissions();

  const silent = !!incident.silent;
  const snap = incident.medical_snapshot;

  // --- camera permission, for the 15-second snapshots ---
  useEffect(() => {
    if (!silent && !camPerm?.granted) requestCam();
  }, [silent, camPerm, requestCam]);

  // --- streaming: breadcrumbs, audio, snapshots ---
  useEffect(() => {
    const stop = startIncidentStreaming(incident, {
      takeSnapshot: silent
        ? null
        : async () => {
            if (!cameraRef.current) return null;
            return cameraRef.current.takePictureAsync({ quality: 0.4, skipProcessing: true });
          },
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident.id]);

  // --- realtime: status changes and incoming messages ---
  useEffect(() => {
    supabase
      .from(TABLES.incidentMessages)
      .select('*')
      .eq('incident_id', incident.id)
      .order('at')
      .then(({ data }) => setMessages(data ?? []));

    const ch = supabase
      .channel(CHANNELS.incident(incident.id))
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: TABLES.incidents,
          filter: `id=eq.${incident.id}`,
        },
        (p) => {
          const next = p.new;
          setIncident((prev) => ({ ...prev, ...next }));
          if (!silent) Vibration.vibrate(40);
          if (next.status === 'resolved' || next.status === 'false_alarm') onResolved();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLES.incidentMessages,
          filter: `incident_id=eq.${incident.id}`,
        },
        (p) => setMessages((prev) => [...prev, p.new]),
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident.id]);

  // --- auto-play incoming voice, unless silent ---
  useEffect(() => {
    if (silent) return;
    const incoming = messages.filter(
      (m) => m.audio_path && m.sender_role !== 'citizen' && !playedRef.current.has(m.id),
    );
    if (incoming.length === 0) return;

    (async () => {
      for (const m of incoming) {
        playedRef.current.add(m.id);
        const { data } = await supabase.storage
          .from('incident-media')
          .createSignedUrl(m.audio_path, 3600);
        if (!data?.signedUrl) continue;
        try {
          const { sound } = await Audio.Sound.createAsync({ uri: data.signedUrl });
          await sound.playAsync();
        } catch {
          /* a clip that will not play is not worth an error dialog */
        }
      }
    })();
  }, [messages, silent]);

  // --- which station / hospital, and who took it ---
  useEffect(() => {
    (async () => {
      if (incident.type === 'medical' && incident.assigned_hospital_id) {
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

      if (incident.assigned_responder_id) {
        const { data } = await supabase
          .from(TABLES.responders)
          .select('full_name, badge_no')
          .eq('id', incident.assigned_responder_id)
          .maybeSingle();
        setResponder(data ?? null);
      }
    })();
  }, [
    incident.assigned_station_id,
    incident.assigned_hospital_id,
    incident.assigned_responder_id,
    incident.type,
  ]);

  // --- push to talk ---
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
      if (uri && durationMs > 300) await sendPtt(incident.id, session.user.id, uri, durationMs);
    } catch {
      /* ignore */
    }
  }

  function markSafe() {
    Alert.alert(
      'Mark yourself safe?',
      'This closes the incident and tells the control room and your guardians that you are all right.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'I am safe',
          style: 'destructive',
          onPress: async () => {
            await resolveIncident(incident.id);
            onResolved();
          },
        },
      ],
    );
  }

  const medical = incident.type === 'medical';
  const tint = medical ? COLORS.amber : COLORS.rose;

  return (
    <View style={S.screen}>
      {/* Off-screen camera, used only for the periodic snapshot. */}
      {!silent && camPerm?.granted && (
        <CameraView
          ref={cameraRef}
          facing="front"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
        />
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <View
          style={{
            backgroundColor: medical ? 'rgba(255,176,32,0.12)' : 'rgba(255,77,141,0.12)',
            borderBottomWidth: 1,
            borderColor: tint,
            paddingTop: 18,
            paddingBottom: 16,
            paddingHorizontal: 20,
          }}
        >
          <Text style={{ color: tint, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>
            {medical ? 'MEDICAL SOS ACTIVE' : 'SAFETY SOS ACTIVE'}
          </Text>
          <Text style={[S.h1, { marginTop: 4 }]}>{incident.public_ref}</Text>
          <Text style={[S.small, { marginTop: 2 }]}>
            {triggerLabel(incident.trigger_reason)} · {formatClock(incident.created_at)}
          </Text>

          <View style={[S.row, { marginTop: 12, gap: 8 }]}>
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
            {incident.status === 'new' && (
              <Text style={S.small}>waiting for the control room…</Text>
            )}
          </View>
        </View>

        {/* Where it went */}
        <View style={[S.pad, { marginTop: 18 }]}>
          <Text style={S.label}>Routed to</Text>
          <View style={[S.card, { marginTop: 8 }]}>
            <Text style={[S.h2, { color: tint }]}>{place ?? 'Resolving…'}</Text>
            <Text style={[S.body, { marginTop: 2 }]}>
              {formatDistance(incident.routing_distance_m)} away · chosen automatically
            </Text>
            {responder && (
              <Text style={{ color: COLORS.mint, marginTop: 8, fontWeight: '700' }}>
                {responder.full_name}
                {responder.badge_no ? ` · ${responder.badge_no}` : ''} has your case
              </Text>
            )}
          </View>
        </View>

        {/* What they can already see */}
        {snap && (
          <View style={[S.pad, { marginTop: 16 }]}>
            <Text style={S.label}>They already have</Text>
            <View style={[S.card, { marginTop: 8, gap: 4 }]}>
              <Text style={S.body}>
                Your name, photo and phone number
              </Text>
              <Text style={S.body}>
                Blood group{' '}
                <Text style={{ color: COLORS.amber, fontWeight: '800' }}>
                  {snap.blood_group ?? '—'}
                </Text>
                {snap.allergies?.length ? `, allergies: ${snap.allergies.join(', ')}` : ''}
              </Text>
              <Text style={S.body}>Your live location and audio</Text>
              <Text style={[S.small, { marginTop: 4 }]}>
                Nobody has to ask you any of this.
              </Text>
            </View>
          </View>
        )}

        {/* Conversation */}
        <View style={[S.pad, { marginTop: 16 }]}>
          <Text style={S.label}>Control room</Text>
          <View style={{ marginTop: 8, gap: 8 }}>
            {messages.length === 0 && (
              <Text style={S.small}>No messages yet. Hold the button below to speak.</Text>
            )}
            {messages.map((m) => {
              const mine = m.sender_role === 'citizen';
              return (
                <View
                  key={m.id}
                  style={{
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    backgroundColor: mine ? 'rgba(255,77,141,0.14)' : COLORS.surfaceAlt,
                    borderColor: mine ? COLORS.rose : COLORS.border,
                    borderWidth: 1,
                    borderRadius: 14,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                  }}
                >
                  <Text style={[S.pillText, { color: mine ? COLORS.rose : COLORS.sky }]}>
                    {mine ? 'YOU' : m.sender_role === 'guardian' ? 'FAMILY' : 'CONTROL ROOM'}
                  </Text>
                  {m.body && (
                    <Text style={{ color: COLORS.text, marginTop: 3, fontSize: 14 }}>
                      {m.body}
                    </Text>
                  )}
                  {m.audio_path && (
                    <Text style={{ color: COLORS.textMuted, marginTop: 3, fontSize: 13 }}>
                      🔊 voice message{silent ? ' (muted — silent mode)' : ''}
                    </Text>
                  )}
                  <Text style={[S.small, { marginTop: 3 }]}>{formatClock(m.at)}</Text>
                </View>
              );
            })}
          </View>

          <View style={[S.row, { marginTop: 12, gap: 8 }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type a message…"
              placeholderTextColor={COLORS.textFaint}
              style={[S.input, { flex: 1 }]}
            />
            <Pressable
              onPress={async () => {
                const b = text;
                setText('');
                await sendMessage(incident.id, session.user.id, b);
              }}
              style={[S.btn, { paddingHorizontal: 18, paddingVertical: 13 }]}
            >
              <Text style={S.btnText}>Send</Text>
            </Pressable>
          </View>

          <Pressable
            onPressIn={startPtt}
            onPressOut={stopPtt}
            style={[
              S.btn,
              {
                marginTop: 10,
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
        </View>

        <View style={[S.pad, { marginTop: 24 }]}>
          <Pressable style={[S.btnGhost, { borderColor: COLORS.mint }]} onPress={markSafe}>
            <Text style={[S.btnGhostText, { color: COLORS.mint }]}>I am safe</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
