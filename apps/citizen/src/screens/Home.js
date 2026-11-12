import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { COLORS, S } from '../lib/ui';
import SosButton from '../components/SosButton';
import { raiseSos, rollingBuffer } from '../lib/sos';
import { watchShake, watchAcoustic } from '../lib/triggers';
import { queueLength, cacheTier1Guardians } from '../lib/offline';
import { supabase } from '../lib/supabase';
import { TABLES } from '@safeher/shared';

const SYMPTOMS = [
  { key: 'chest_pain', label: 'Chest pain' },
  { key: 'breathing', label: 'Breathing' },
  { key: 'bleeding', label: 'Bleeding' },
  { key: 'unconscious', label: 'Unconscious' },
  { key: 'accident', label: 'Accident' },
  { key: 'other', label: 'Other' },
];

export default function Home({ navigation, session, onIncident }) {
  const [firing, setFiring] = useState(false);
  const [symptomOpen, setSymptomOpen] = useState(false);
  const [status, setStatus] = useState({
    guardians: 0,
    buffered: 0,
    accuracy: null,
    online: true,
    queued: 0,
  });

  // --- the live status strip ---
  const refreshStatus = useCallback(async () => {
    const [{ count }, queued] = await Promise.all([
      supabase
        .from(TABLES.guardians)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('status', 'active'),
      queueLength(),
    ]);

    let accuracy = null;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const last = await Location.getLastKnownPositionAsync();
        accuracy = last?.coords?.accuracy ?? null;
      }
    } catch {
      /* ignore */
    }

    setStatus((s) => ({
      ...s,
      guardians: count ?? 0,
      buffered: rollingBuffer.segments.length * 20,
      accuracy,
      queued,
    }));
  }, [session.user.id]);

  useEffect(() => {
    // The buffer starts the moment the app opens, not when an SOS fires.
    // That is the entire point: the 60 seconds before the press.
    rollingBuffer.start();
    cacheTier1Guardians(session.user.id).catch(() => {});
    refreshStatus();
    const t = setInterval(refreshStatus, 4000);
    return () => clearInterval(t);
  }, [refreshStatus, session.user.id]);

  // --- hands-free triggers ---
  useEffect(() => {
    const stopShake = watchShake((reason) => fire('safety', reason));
    const stopAcoustic = watchAcoustic((reason) => fire('safety', reason));
    return () => {
      stopShake();
      stopAcoustic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fire(type, reason, silent = false) {
    if (firing) return;
    setFiring(true);
    const result = await raiseSos({ type, reason, silent });
    setFiring(false);

    if (result.path === 'queued') {
      Alert.alert(
        'Sent by SMS only',
        `No connection to the control room.\n\n` +
          `• Your alert is queued and will sync automatically.\n` +
          `• ${result.sms?.sent ? `SMS sent to ${result.sms.recipients} guardian(s).` : 'SMS could not be sent.'}\n\n` +
          `The control room does NOT have this yet.`,
      );
      return;
    }
    onIncident(result.incident);
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={[S.pad, { paddingTop: 16, paddingBottom: 8 }]}>
        <View style={[S.row, { justifyContent: 'space-between' }]}>
          <Text style={S.h1}>
            Safe<Text style={{ color: COLORS.rose }}>Her</Text>
          </Text>
          <Pressable onPress={() => navigation.navigate('Profile')} hitSlop={10}>
            <Text style={{ color: COLORS.textMuted, fontSize: 22 }}>⋯</Text>
          </Pressable>
        </View>
        <Text style={[S.body, { marginTop: 2 }]}>
          Your circle and the nearest control room are one press away.
        </Text>
      </View>

      {/* The two SOS actions. Never confusable: different colour, shape,
          label and position. */}
      <View style={[S.pad, { gap: 14, marginTop: 10 }]}>
        <SosButton
          variant="safety"
          title="SAFETY SOS"
          subtitle="hold 1.2s · police"
          disabled={firing}
          onFire={() => fire('safety', 'manual')}
        />
        <SosButton
          variant="medical"
          title="MEDICAL SOS"
          subtitle="hold 1.2s · ambulance"
          disabled={firing}
          onFire={() => setSymptomOpen(true)}
        />
      </View>

      {firing && (
        <View style={[S.row, S.pad, { marginTop: 14, gap: 8 }]}>
          <ActivityIndicator color={COLORS.rose} />
          <Text style={S.body}>Raising the alert…</Text>
        </View>
      )}

      {/* Live status strip */}
      <View style={[S.pad, { marginTop: 22 }]}>
        <Text style={S.label}>Right now</Text>
        <View style={[S.card, { marginTop: 8, gap: 10 }]}>
          <StatusRow
            label="Guardians watching"
            value={status.guardians === 0 ? 'none yet' : `${status.guardians} active`}
            tone={status.guardians > 0 ? COLORS.mint : COLORS.amber}
            action={status.guardians === 0 ? () => navigation.navigate('Guardians') : null}
          />
          <StatusRow
            label="Audio buffered"
            value={`${Math.min(status.buffered, 60)}s ready to seal`}
            tone={status.buffered > 0 ? COLORS.lilac : COLORS.textFaint}
          />
          <StatusRow
            label="Location accuracy"
            value={
              status.accuracy == null
                ? 'no fix yet'
                : `±${Math.round(status.accuracy)} m`
            }
            tone={
              status.accuracy == null
                ? COLORS.amber
                : status.accuracy <= 20
                  ? COLORS.mint
                  : COLORS.amber
            }
          />
          {status.queued > 0 && (
            <StatusRow
              label="Queued offline alerts"
              value={`${status.queued} waiting to sync`}
              tone={COLORS.critical}
            />
          )}
        </View>

        <Text style={[S.small, { marginTop: 10, lineHeight: 17 }]}>
          SafeHer keeps the last 60 seconds of audio on your phone and only sends it if you
          raise an alert. Shake three times, or a sustained scream, will also trigger a
          safety SOS.
        </Text>
      </View>

      {/* Secondary actions */}
      <View style={[S.pad, { marginTop: 22, gap: 10 }]}>
        <Pressable style={S.btnGhost} onPress={() => navigation.navigate('Journey')}>
          <Text style={S.btnGhostText}>Start a journey</Text>
        </Pressable>
        <View style={[S.row, { gap: 10 }]}>
          <Pressable
            style={[S.btnGhost, { flex: 1 }]}
            onPress={() => navigation.navigate('Guardians')}
          >
            <Text style={S.btnGhostText}>Guardians</Text>
          </Pressable>
          <Pressable
            style={[S.btnGhost, { flex: 1 }]}
            onPress={() => navigation.navigate('History')}
          >
            <Text style={S.btnGhostText}>History</Text>
          </Pressable>
        </View>
      </View>

      {/* Symptom chooser — shown during the medical countdown, always
          skippable. Never block the alert on a taxonomy. */}
      <Modal visible={symptomOpen} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
              paddingBottom: 34,
              borderTopWidth: 1,
              borderColor: COLORS.amber,
            }}
          >
            <Text style={[S.h2, { color: COLORS.amber }]}>What is happening?</Text>
            <Text style={[S.small, { marginTop: 4 }]}>
              One tap helps the ambulance prepare. You can skip this.
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {SYMPTOMS.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => {
                    setSymptomOpen(false);
                    fire('medical', s.key);
                  }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: COLORS.amber,
                    backgroundColor: 'rgba(255,176,32,0.10)',
                  }}
                >
                  <Text style={{ color: COLORS.amberSoft, fontWeight: '700' }}>{s.label}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[S.btn, { marginTop: 18, backgroundColor: COLORS.amber }]}
              onPress={() => {
                setSymptomOpen(false);
                fire('medical', 'medical_manual');
              }}
            >
              <Text style={[S.btnText, { color: '#231400' }]}>Skip — send now</Text>
            </Pressable>
            <Pressable style={{ marginTop: 10, alignItems: 'center' }} onPress={() => setSymptomOpen(false)}>
              <Text style={{ color: COLORS.textFaint, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function StatusRow({ label, value, tone, action }) {
  const content = (
    <View style={[S.row, { justifyContent: 'space-between' }]}>
      <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>{label}</Text>
      <View style={[S.row, { gap: 6 }]}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone }} />
        <Text style={{ color: tone, fontSize: 13, fontWeight: '700' }}>{value}</Text>
      </View>
    </View>
  );
  return action ? <Pressable onPress={action}>{content}</Pressable> : content;
}
