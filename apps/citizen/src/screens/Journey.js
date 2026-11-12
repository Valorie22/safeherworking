import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, S } from '../lib/ui';
import { raiseSos } from '../lib/sos';
import { CHANNELS, EVENTS, RPC, TABLES, formatCountdown } from '@safeher/shared';

/**
 * The dead-man's switch.
 *
 * Start a journey with a check-in rhythm. Miss one, get a grace period,
 * and if that lapses SafeHer raises a safety SOS on your behalf with
 * trigger_reason = 'journey'.
 *
 * Every state change is broadcast on user:{user_id}, which is how a
 * parent watches the countdown tick in SafeHer Circle. That is the part
 * that makes the system feel real to them before anything goes wrong.
 */

const GRACE_SECONDS = 60;

export default function Journey({ navigation, session, onIncident }) {
  const [journey, setJourney] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState({ destination: '', eta: '30', interval: '300' });
  const breachedRef = useRef(false);

  useEffect(() => {
    supabase
      .from(TABLES.journeys)
      .select('*')
      .eq('user_id', session.user.id)
      .in('state', ['running', 'overdue'])
      .order('started_at', { ascending: false })
      .limit(1)
      .then(({ data }) => setJourney(data?.[0] ?? null));
  }, [session.user.id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // --- the switch itself ---
  useEffect(() => {
    if (!journey || journey.state === 'completed' || breachedRef.current) return;

    const due = +new Date(journey.next_checkin_at);
    const overdueBy = (now - due) / 1000;

    if (overdueBy > 0 && journey.state === 'running') {
      setJourney((j) => ({ ...j, state: 'overdue' }));
      supabase
        .from(TABLES.journeys)
        .update({ state: 'overdue' })
        .eq('id', journey.id)
        .then(() => broadcast(EVENTS.JOURNEY_OVERDUE, { journey_id: journey.id }));
    }

    if (overdueBy > GRACE_SECONDS) {
      breachedRef.current = true;
      (async () => {
        await supabase
          .from(TABLES.journeys)
          .update({ state: 'breached', ended_at: new Date().toISOString() })
          .eq('id', journey.id);
        await broadcast(EVENTS.JOURNEY_BREACHED, { journey_id: journey.id });

        const result = await raiseSos({ type: 'safety', reason: 'journey' });
        if (result.incident) onIncident(result.incident);
      })();
    }
  }, [now, journey, onIncident]);

  async function broadcast(event, payload) {
    const ch = supabase.channel(CHANNELS.user(session.user.id));
    await ch.subscribe();
    await ch.send({ type: 'broadcast', event, payload: { ...payload, at: new Date().toISOString() } });
    supabase.removeChannel(ch);
  }

  async function start() {
    const interval = Math.max(30, parseInt(form.interval, 10) || 300);
    const { data, error } = await supabase
      .from(TABLES.journeys)
      .insert({
        user_id: session.user.id,
        label: form.destination || 'Journey',
        destination: form.destination || null,
        eta_minutes: parseInt(form.eta, 10) || null,
        interval_seconds: interval,
        next_checkin_at: new Date(Date.now() + interval * 1000).toISOString(),
        state: 'running',
      })
      .select()
      .single();

    if (error) return Alert.alert('Could not start', error.message);
    breachedRef.current = false;
    setJourney(data);
    broadcast(EVENTS.JOURNEY_STARTED, { journey_id: data.id, destination: data.destination });
  }

  async function checkIn() {
    const { data, error } = await supabase.rpc(RPC.journeyCheckin, { p_journey_id: journey.id });
    if (error) return Alert.alert('Check-in failed', error.message);
    setJourney(data);
    broadcast(EVENTS.JOURNEY_CHECKIN, { journey_id: journey.id });
  }

  async function finish() {
    await supabase
      .from(TABLES.journeys)
      .update({ state: 'completed', ended_at: new Date().toISOString() })
      .eq('id', journey.id);
    setJourney(null);
    navigation.goBack();
  }

  if (journey) {
    const overdue = journey.state === 'overdue';
    const secsLeft = Math.round((+new Date(journey.next_checkin_at) - now) / 1000);
    const graceLeft = GRACE_SECONDS + secsLeft;

    return (
      <ScrollView style={S.screen} contentContainerStyle={{ padding: 22 }}>
        <Text style={S.label}>Journey in progress</Text>
        <Text style={[S.h1, { marginTop: 4 }]}>{journey.destination || 'On the move'}</Text>

        <View
          style={[
            S.card,
            {
              marginTop: 24,
              alignItems: 'center',
              paddingVertical: 36,
              borderColor: overdue ? COLORS.critical : COLORS.lilac,
            },
          ]}
        >
          <Text style={S.label}>{overdue ? 'Grace period' : 'Next check-in'}</Text>
          <Text
            style={{
              color: overdue ? COLORS.critical : COLORS.lilac,
              fontSize: 60,
              fontWeight: '900',
              marginTop: 6,
            }}
          >
            {overdue
              ? `0:${String(Math.max(0, graceLeft)).padStart(2, '0')}`
              : formatCountdown(journey.next_checkin_at, now)}
          </Text>
          {overdue && (
            <Text style={{ color: COLORS.critical, marginTop: 8, textAlign: 'center' }}>
              Miss this and SafeHer raises a safety SOS for you.
            </Text>
          )}
        </View>

        <Pressable style={[S.btn, { marginTop: 22 }]} onPress={checkIn}>
          <Text style={S.btnText}>I'm fine — check in</Text>
        </Pressable>

        <Pressable style={[S.btnGhost, { marginTop: 10 }]} onPress={finish}>
          <Text style={S.btnGhostText}>I've arrived — end journey</Text>
        </Pressable>

        <Text style={[S.small, { marginTop: 18, lineHeight: 17 }]}>
          Your guardians can see this countdown right now. Nobody has pressed an emergency
          button, and the system is already watching.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 22 }}>
      <Text style={S.h1}>Start a journey</Text>
      <Text style={[S.body, { marginTop: 6 }]}>
        SafeHer checks in on you at a rhythm you set. If you stop answering, it raises the
        alarm without you having to.
      </Text>

      <View style={{ marginTop: 22 }}>
        <Text style={S.label}>Where are you going?</Text>
        <TextInput
          value={form.destination}
          onChangeText={(v) => setForm({ ...form, destination: v })}
          placeholder="Metro station, east gate"
          placeholderTextColor={COLORS.textFaint}
          style={[S.input, { marginTop: 6 }]}
        />
      </View>

      <View style={[S.row, { gap: 12, marginTop: 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={S.label}>ETA (min)</Text>
          <TextInput
            value={form.eta}
            onChangeText={(v) => setForm({ ...form, eta: v })}
            keyboardType="number-pad"
            style={[S.input, { marginTop: 6 }]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={S.label}>Check in every (s)</Text>
          <TextInput
            value={form.interval}
            onChangeText={(v) => setForm({ ...form, interval: v })}
            keyboardType="number-pad"
            style={[S.input, { marginTop: 6 }]}
          />
        </View>
      </View>

      <View style={[S.row, { gap: 8, marginTop: 12 }]}>
        {[
          { label: '30s (demo)', v: '30' },
          { label: '5 min', v: '300' },
          { label: '15 min', v: '900' },
        ].map((o) => (
          <Pressable
            key={o.v}
            onPress={() => setForm({ ...form, interval: o.v })}
            style={{
              paddingHorizontal: 13,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: form.interval === o.v ? COLORS.lilac : COLORS.border,
            }}
          >
            <Text
              style={{
                color: form.interval === o.v ? COLORS.lilac : COLORS.textFaint,
                fontWeight: '700',
                fontSize: 12,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[S.btn, { marginTop: 26 }]} onPress={start}>
        <Text style={S.btnText}>Start journey</Text>
      </Pressable>
    </ScrollView>
  );
}
