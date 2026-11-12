import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, S } from '../lib/ui';
import { TABLES } from '@safeher/shared';
import { NORMAL_PIN, DURESS_PIN } from './Shadow';

export default function Profile({ session }) {
  const [p, setP] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from(TABLES.profiles)
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setP(data));
  }, [session.user.id]);

  if (!p) return <View style={S.screen} />;

  const joined = (a) => (Array.isArray(a) ? a.join(', ') : (a ?? ''));
  const split = (s) =>
    String(s || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from(TABLES.profiles)
      .update({
        full_name: p.full_name,
        phone: p.phone,
        address: p.address,
        blood_group: p.blood_group,
        allergies: Array.isArray(p.allergies) ? p.allergies : split(p.allergies),
        conditions: Array.isArray(p.conditions) ? p.conditions : split(p.conditions),
        medications: Array.isArray(p.medications) ? p.medications : split(p.medications),
        emergency_note: p.emergency_note,
      })
      .eq('id', session.user.id);
    setSaving(false);
    Alert.alert(
      error ? 'Could not save' : 'Saved',
      error?.message ?? 'Your record is up to date.',
    );
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 22, paddingBottom: 60 }}>
      <Text style={S.h1}>Your record</Text>
      <Text style={[S.body, { marginTop: 6 }]}>
        Editing this changes what future alerts carry. Alerts you have already raised keep
        the values they were sent with — responders are never shown a record that has
        silently changed under them.
      </Text>

      <F label="Full name" v={p.full_name} set={(v) => setP({ ...p, full_name: v })} />
      <F label="Phone" v={p.phone} set={(v) => setP({ ...p, phone: v })} />
      <F label="Home address" v={p.address} set={(v) => setP({ ...p, address: v })} multiline />
      <F label="Blood group" v={p.blood_group} set={(v) => setP({ ...p, blood_group: v })} />
      <F label="Allergies" v={joined(p.allergies)} set={(v) => setP({ ...p, allergies: v })} />
      <F label="Conditions" v={joined(p.conditions)} set={(v) => setP({ ...p, conditions: v })} />
      <F
        label="Medications"
        v={joined(p.medications)}
        set={(v) => setP({ ...p, medications: v })}
      />
      <F
        label="Emergency note"
        v={p.emergency_note}
        set={(v) => setP({ ...p, emergency_note: v })}
        multiline
      />

      <Pressable style={[S.btn, { marginTop: 22 }]} onPress={save} disabled={saving}>
        <Text style={S.btnText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>

      <View style={[S.card, { marginTop: 26, borderColor: COLORS.lilac }]}>
        <Text style={[S.label, { color: COLORS.lilac }]}>Shadow mode</Text>
        <Text style={[S.body, { marginTop: 6 }]}>
          SafeHer can launch as a calculator. Your PIN opens the app; the duress PIN opens
          it identically and silently raises an alert nobody watching your screen can see.
        </Text>
        <Text style={{ color: COLORS.textMuted, marginTop: 10, fontFamily: 'monospace' }}>
          PIN {NORMAL_PIN} · DURESS {DURESS_PIN}
        </Text>
        <Text style={[S.small, { marginTop: 6 }]}>
          Demo values, hardcoded in Shadow.js. A real build stores these in the device
          keychain and never displays the duress PIN anywhere.
        </Text>
      </View>

      <Pressable style={[S.btnGhost, { marginTop: 22 }]} onPress={() => supabase.auth.signOut()}>
        <Text style={[S.btnGhostText, { color: COLORS.critical }]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function F({ label, v, set, multiline }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={S.label}>{label}</Text>
      <TextInput
        value={v ?? ''}
        onChangeText={set}
        multiline={multiline}
        placeholderTextColor={COLORS.textFaint}
        style={[S.input, { marginTop: 6, minHeight: multiline ? 70 : undefined }]}
      />
    </View>
  );
}
