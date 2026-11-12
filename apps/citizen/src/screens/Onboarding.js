import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, S } from '../lib/ui';
import { TABLES } from '@safeher/shared';

/**
 * Onboarding.
 *
 * The medical step is mandatory and every field says why it is asked.
 * "A paramedic reads this before they reach you" is not marketing — it
 * is the literal mechanism, and people fill in a form they understand.
 */

const BLOOD_GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

export default function Onboarding({ session, onDone }) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [p, setP] = useState({
    full_name: '',
    phone: session.user.phone ? `+${session.user.phone}` : '',
    date_of_birth: '',
    gender: '',
    address: '',
    blood_group: '',
    allergies: '',
    conditions: '',
    medications: '',
    emergency_note: '',
    organ_donor: false,
  });

  const [g, setG] = useState({ name: '', phone: '', relation: '', tier: 1 });
  const [inviteCode, setInviteCode] = useState(null);

  const list = (s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  async function saveProfile() {
    if (!p.full_name.trim() || !p.phone.trim()) {
      Alert.alert('Almost', 'Your name and phone number are required.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from(TABLES.profiles).upsert({
      id: session.user.id,
      full_name: p.full_name.trim(),
      phone: p.phone.trim(),
      date_of_birth: p.date_of_birth || null,
      gender: p.gender || null,
      address: p.address || null,
      blood_group: p.blood_group || null,
      allergies: list(p.allergies),
      conditions: list(p.conditions),
      medications: list(p.medications),
      emergency_note: p.emergency_note || null,
      organ_donor: p.organ_donor,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not save', error.message);
    setStep(2);
  }

  async function saveGuardian() {
    if (!g.name.trim() || !g.phone.trim()) {
      Alert.alert('Almost', 'A guardian needs a name and a number.');
      return;
    }
    setBusy(true);
    const code = `SAFE-${Math.floor(1000 + Math.random() * 9000)}`;
    const { error } = await supabase.from(TABLES.guardians).insert({
      user_id: session.user.id,
      name: g.name.trim(),
      phone: g.phone.trim(),
      relation: g.relation || null,
      tier: g.tier,
      invite_code: code,
      status: 'pending',
    });
    setBusy(false);
    if (error) return Alert.alert('Could not save', error.message);
    setInviteCode(code);
    setStep(3);
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 22, paddingBottom: 60 }}>
      <Text style={S.label}>Step {step} of 3</Text>

      {step === 1 && (
        <>
          <Text style={[S.h1, { marginTop: 6 }]}>Your medical record</Text>
          <Text style={[S.body, { marginTop: 6, marginBottom: 20 }]}>
            This travels with every alert you raise. A paramedic reads it before they reach
            you — so nobody has to ask you anything while you are hurt.
          </Text>

          <Field label="Full name" hint="what a responder will call you" value={p.full_name} onChange={(v) => setP({ ...p, full_name: v })} />
          <Field label="Phone" hint="how your circle is reached" value={p.phone} onChange={(v) => setP({ ...p, phone: v })} keyboardType="phone-pad" />
          <Field label="Date of birth" hint="YYYY-MM-DD · drug doses depend on age" value={p.date_of_birth} onChange={(v) => setP({ ...p, date_of_birth: v })} />
          <Field label="Gender" hint="shown to the responding officer" value={p.gender} onChange={(v) => setP({ ...p, gender: v })} />
          <Field label="Home address" hint="where you are taken if you cannot say" value={p.address} onChange={(v) => setP({ ...p, address: v })} multiline />

          <Text style={[S.label, { marginTop: 18 }]}>Blood group</Text>
          <Text style={S.small}>the first thing an ER team looks for</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {BLOOD_GROUPS.map((b) => (
              <Pressable
                key={b}
                onPress={() => setP({ ...p, blood_group: b })}
                style={{
                  paddingHorizontal: 15,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: p.blood_group === b ? COLORS.amber : COLORS.border,
                  backgroundColor:
                    p.blood_group === b ? 'rgba(255,176,32,0.14)' : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: p.blood_group === b ? COLORS.amber : COLORS.textMuted,
                    fontWeight: '800',
                  }}
                >
                  {b}
                </Text>
              </Pressable>
            ))}
          </View>

          <Field label="Allergies" hint="comma separated · stops a fatal injection" value={p.allergies} onChange={(v) => setP({ ...p, allergies: v })} />
          <Field label="Conditions" hint="asthma, diabetes, epilepsy…" value={p.conditions} onChange={(v) => setP({ ...p, conditions: v })} />
          <Field label="Medications" hint="what you already have in you" value={p.medications} onChange={(v) => setP({ ...p, medications: v })} />
          <Field label="Emergency note" hint="anything a stranger must know in ten seconds" value={p.emergency_note} onChange={(v) => setP({ ...p, emergency_note: v })} multiline />

          <Pressable
            onPress={() => setP({ ...p, organ_donor: !p.organ_donor })}
            style={[S.row, { marginTop: 16, gap: 10 }]}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: p.organ_donor ? COLORS.mint : COLORS.border,
                backgroundColor: p.organ_donor ? COLORS.mint : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {p.organ_donor && <Text style={{ color: COLORS.bg, fontWeight: '900' }}>✓</Text>}
            </View>
            <Text style={S.body}>I am a registered organ donor</Text>
          </Pressable>

          <Pressable style={[S.btn, { marginTop: 26 }]} onPress={saveProfile} disabled={busy}>
            <Text style={S.btnText}>{busy ? 'Saving…' : 'Continue'}</Text>
          </Pressable>
        </>
      )}

      {step === 2 && (
        <>
          <Text style={[S.h1, { marginTop: 6 }]}>Add a guardian</Text>
          <Text style={[S.body, { marginTop: 6, marginBottom: 20 }]}>
            Someone who should know immediately. They install SafeHer Circle and watch the
            same live alert the control room sees — but they can only see your medical record
            while an emergency is actually open.
          </Text>

          <Field label="Name" value={g.name} onChange={(v) => setG({ ...g, name: v })} />
          <Field label="Phone" value={g.phone} onChange={(v) => setG({ ...g, phone: v })} keyboardType="phone-pad" />
          <Field label="Relation" hint="mother, flatmate, partner…" value={g.relation} onChange={(v) => setG({ ...g, relation: v })} />

          <Text style={[S.label, { marginTop: 18 }]}>Tier</Text>
          <Text style={S.small}>tier 1 is told first, and by SMS even with no data</Text>
          <View style={[S.row, { gap: 8, marginTop: 8 }]}>
            {[1, 2, 3].map((t) => (
              <Pressable
                key={t}
                onPress={() => setG({ ...g, tier: t })}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  alignItems: 'center',
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: g.tier === t ? COLORS.rose : COLORS.border,
                  backgroundColor: g.tier === t ? 'rgba(255,77,141,0.14)' : 'transparent',
                }}
              >
                <Text style={{ color: g.tier === t ? COLORS.rose : COLORS.textMuted, fontWeight: '800' }}>
                  Tier {t}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={[S.btn, { marginTop: 26 }]} onPress={saveGuardian} disabled={busy}>
            <Text style={S.btnText}>{busy ? 'Saving…' : 'Create invite'}</Text>
          </Pressable>
        </>
      )}

      {step === 3 && (
        <>
          <Text style={[S.h1, { marginTop: 6 }]}>Share this code</Text>
          <Text style={[S.body, { marginTop: 6 }]}>
            {g.name} enters it in SafeHer Circle to start watching over you.
          </Text>

          <View
            style={[
              S.card,
              { marginTop: 24, alignItems: 'center', paddingVertical: 32, borderColor: COLORS.rose },
            ]}
          >
            <Text style={{ color: COLORS.rose, fontSize: 38, fontWeight: '900', letterSpacing: 4 }}>
              {inviteCode}
            </Text>
          </View>

          <Pressable style={[S.btn, { marginTop: 28 }]} onPress={onDone}>
            <Text style={S.btnText}>Done — take me to SafeHer</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function Field({ label, hint, value, onChange, multiline, keyboardType }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={S.label}>{label}</Text>
      {hint ? <Text style={S.small}>{hint}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholderTextColor={COLORS.textFaint}
        style={[S.input, { marginTop: 6, minHeight: multiline ? 70 : undefined }]}
      />
    </View>
  );
}
