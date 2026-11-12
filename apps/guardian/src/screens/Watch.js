import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, S } from '../lib/ui';
import { TABLES, formatCountdown, formatDateTime, initials } from '@safeher/shared';

/**
 * Watch — the home screen.
 *
 * One card per ward. When a journey is running the parent sees the
 * check-in countdown ticking live. That is what makes the system feel
 * real to them before anything has gone wrong: nobody has pressed an
 * emergency button, and it is already watching.
 */
export default function Watch({ navigation, session }) {
  const [wards, setWards] = useState([]);
  const [journeys, setJourneys] = useState({});
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // ward_profiles is a view with NO medical columns in it. A guardian
    // literally cannot select a blood group through this path — see the
    // note at the top of 0003_rls.sql.
    const { data: profiles } = await supabase.from(TABLES.wardProfiles).select('*');
    setWards(profiles ?? []);

    const ids = (profiles ?? []).map((p) => p.id);
    if (ids.length) {
      const { data: js } = await supabase
        .from(TABLES.journeys)
        .select('*')
        .in('user_id', ids)
        .in('state', ['running', 'overdue']);
      const byUser = {};
      for (const j of js ?? []) byUser[j.user_id] = j;
      setJourneys(byUser);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Keep the journey countdown honest in real time.
  useEffect(() => {
    const ch = supabase
      .channel('circle-journeys')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLES.journeys }, () =>
        load(),
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load]);

  return (
    <ScrollView
      style={S.screen}
      contentContainerStyle={{ padding: 22, paddingBottom: 50 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={COLORS.lilac}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={[S.row, { justifyContent: 'space-between' }]}>
        <Text style={S.h1}>
          Safe<Text style={{ color: COLORS.lilac }}>Her</Text> Circle
        </Text>
        <Pressable onPress={() => supabase.auth.signOut()} hitSlop={10}>
          <Text style={{ color: COLORS.textFaint, fontSize: 13 }}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={[S.body, { marginTop: 4 }]}>
        {wards.length === 0
          ? 'You are not watching over anyone yet.'
          : `Watching over ${wards.length} ${wards.length === 1 ? 'person' : 'people'}.`}
      </Text>

      <View style={{ gap: 12, marginTop: 22 }}>
        {wards.map((w) => {
          const j = journeys[w.id];
          const overdue = j?.state === 'overdue';
          const tone = overdue ? COLORS.critical : j ? COLORS.sky : COLORS.mint;

          return (
            <View key={w.id} style={[S.card, { borderColor: tone }]}>
              <View style={[S.row, { gap: 12 }]}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    backgroundColor: 'rgba(192,140,245,0.15)',
                    borderWidth: 1,
                    borderColor: COLORS.lilac,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: COLORS.lilacSoft, fontWeight: '800' }}>
                    {initials(w.full_name)}
                  </Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={S.h2}>{w.full_name}</Text>
                  <View style={[S.row, { gap: 6, marginTop: 3 }]}>
                    <View
                      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }}
                    />
                    <Text style={{ color: tone, fontWeight: '700', fontSize: 13 }}>
                      {overdue ? 'CHECK-IN OVERDUE' : j ? 'On a journey' : 'Safe'}
                    </Text>
                  </View>
                </View>
              </View>

              {j && (
                <View
                  style={{
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: COLORS.bgDeep,
                    alignItems: 'center',
                  }}
                >
                  <Text style={S.label}>
                    {overdue ? 'Overdue — SafeHer is about to raise the alarm' : 'Next check-in'}
                  </Text>
                  <Text
                    style={{
                      color: tone,
                      fontSize: 42,
                      fontWeight: '900',
                      marginTop: 4,
                    }}
                  >
                    {formatCountdown(j.next_checkin_at, now)}
                  </Text>
                  {j.destination ? (
                    <Text style={[S.small, { marginTop: 4 }]}>heading to {j.destination}</Text>
                  ) : null}
                </View>
              )}

              <Pressable
                onPress={() => navigation.navigate('History', { wardId: w.id, name: w.full_name })}
                style={{ marginTop: 12 }}
              >
                <Text style={{ color: COLORS.lilac, fontWeight: '700', fontSize: 13 }}>
                  View history →
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Pressable style={[S.btnGhost, { marginTop: 22 }]} onPress={() => navigation.navigate('Link')}>
        <Text style={S.btnGhostText}>Link another ward</Text>
      </Pressable>

      <Text style={[S.small, { marginTop: 20, lineHeight: 17 }]}>
        You see their live alerts and their location during an emergency. Their medical record
        is visible only while an emergency is open, and they can revoke your access at any
        time.
      </Text>
    </ScrollView>
  );
}
