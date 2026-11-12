import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, S } from '../lib/ui';
import { cacheTier1Guardians } from '../lib/offline';
import { TABLES } from '@safeher/shared';

export default function Guardians({ session }) {
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [g, setG] = useState({ name: '', phone: '', relation: '', tier: 1 });

  const load = useCallback(async () => {
    const { data } = await supabase
      .from(TABLES.guardians)
      .select('*')
      .eq('user_id', session.user.id)
      .order('tier');
    setRows(data ?? []);
    cacheTier1Guardians(session.user.id).catch(() => {});
  }, [session.user.id]);

  useEffect(() => {
    load();
  }, [load]);

  function newCode() {
    return 'SAFE-' + Math.floor(1000 + Math.random() * 9000);
  }

  async function add() {
    if (!g.name.trim() || !g.phone.trim()) return;
    const { error } = await supabase.from(TABLES.guardians).insert({
      user_id: session.user.id,
      name: g.name.trim(),
      phone: g.phone.trim(),
      relation: g.relation || null,
      tier: g.tier,
      invite_code: newCode(),
      status: 'pending',
    });
    if (error) return Alert.alert('Could not add', error.message);
    setG({ name: '', phone: '', relation: '', tier: 1 });
    setAdding(false);
    load();
  }

  // Revoking is instant and the guardian is told. A circle you cannot
  // leave is not a circle.
  function revoke(row) {
    Alert.alert('Revoke access?', row.name + ' will stop seeing your alerts immediately.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          await supabase.from(TABLES.guardians).update({ status: 'revoked' }).eq('id', row.id);
          load();
        },
      },
    ]);
  }

  const tone = (status) =>
    status === 'active' ? COLORS.mint : status === 'revoked' ? COLORS.grey : COLORS.amber;

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 22, paddingBottom: 60 }}>
      <Text style={S.h1}>Your circle</Text>
      <Text style={[S.body, { marginTop: 6 }]}>
        Guardians see your live alert, and your medical record only while an emergency is
        open. You can revoke any of them at any time.
      </Text>

      <View style={{ gap: 10, marginTop: 20 }}>
        {rows.map((r) => (
          <View key={r.id} style={S.card}>
            <View style={[S.row, { justifyContent: 'space-between' }]}>
              <Text style={S.h2}>{r.name}</Text>
              <View style={[S.pill, { borderColor: tone(r.status) }]}>
                <Text style={[S.pillText, { color: tone(r.status) }]}>
                  {r.status.toUpperCase()}
                </Text>
              </View>
            </View>

            <Text style={S.body}>
              {r.relation ? r.relation + ' · ' : ''}
              {r.phone} · tier {r.tier}
            </Text>

            {r.status === 'pending' && r.invite_code ? (
              <Text
                style={{
                  color: COLORS.rose,
                  marginTop: 8,
                  fontWeight: '800',
                  letterSpacing: 2,
                }}
              >
                Invite code: {r.invite_code}
              </Text>
            ) : null}

            {r.status !== 'revoked' && (
              <Pressable onPress={() => revoke(r)} style={{ marginTop: 10 }}>
                <Text style={{ color: COLORS.critical, fontWeight: '700', fontSize: 13 }}>
                  Revoke access
                </Text>
              </Pressable>
            )}
          </View>
        ))}
        {rows.length === 0 && <Text style={S.small}>Nobody is watching over you yet.</Text>}
      </View>

      {adding ? (
        <View style={[S.card, { marginTop: 18, gap: 12 }]}>
          <TextInput
            value={g.name}
            onChangeText={(v) => setG({ ...g, name: v })}
            placeholder="Name"
            placeholderTextColor={COLORS.textFaint}
            style={S.input}
          />
          <TextInput
            value={g.phone}
            onChangeText={(v) => setG({ ...g, phone: v })}
            placeholder="Phone"
            keyboardType="phone-pad"
            placeholderTextColor={COLORS.textFaint}
            style={S.input}
          />
          <TextInput
            value={g.relation}
            onChangeText={(v) => setG({ ...g, relation: v })}
            placeholder="Relation"
            placeholderTextColor={COLORS.textFaint}
            style={S.input}
          />
          <View style={[S.row, { gap: 8 }]}>
            {[1, 2, 3].map((t) => (
              <Pressable
                key={t}
                onPress={() => setG({ ...g, tier: t })}
                style={{
                  flex: 1,
                  paddingVertical: 11,
                  alignItems: 'center',
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: g.tier === t ? COLORS.rose : COLORS.border,
                }}
              >
                <Text
                  style={{
                    color: g.tier === t ? COLORS.rose : COLORS.textMuted,
                    fontWeight: '800',
                  }}
                >
                  Tier {t}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={S.btn} onPress={add}>
            <Text style={S.btnText}>Create invite</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={[S.btnGhost, { marginTop: 18 }]} onPress={() => setAdding(true)}>
          <Text style={S.btnGhostText}>Add a guardian</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
