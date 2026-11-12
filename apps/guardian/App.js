import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from './src/lib/supabase';
import { COLORS, S, statusTone } from './src/lib/ui';
import { TABLES, formatDateTime, statusLabel, triggerLabel } from '@safeher/shared';

import Auth from './src/screens/Auth';
import Watch from './src/screens/Watch';
import Link from './src/screens/Link';
import AlertScreen from './src/screens/AlertScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  dark: true,
  colors: {
    primary: COLORS.lilac,
    background: COLORS.bg,
    card: COLORS.surface,
    text: COLORS.text,
    border: COLORS.border,
    notification: COLORS.rose,
  },
};

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [incident, setIncident] = useState(null);
  const [ward, setWard] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  /**
   * The takeover.
   *
   * RLS only returns a ward's incident while it is live, so anything
   * that arrives here is by definition an active emergency for someone
   * this account guards. No client-side filtering decides that.
   */
  useEffect(() => {
    if (!session) return;

    async function attach(row) {
      const { data: w } = await supabase
        .from(TABLES.wardProfiles)
        .select('*')
        .eq('id', row.user_id)
        .maybeSingle();
      setWard(w ?? null);
      setIncident(row);
    }

    // Catch an alert that fired while the app was closed.
    supabase
      .from(TABLES.incidents)
      .select('*')
      .not('status', 'in', '(resolved,false_alarm)')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) attach(data[0]);
      });

    const ch = supabase
      .channel('circle-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: TABLES.incidents },
        (p) => attach(p.new),
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [session]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.lilac} />
      </View>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Auth />
      </SafeAreaProvider>
    );
  }

  // An active alert owns the entire app. Nothing else is reachable.
  if (incident) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AlertScreen
          incident={incident}
          ward={ward}
          session={session}
          onCleared={() => {
            setIncident(null);
            setWard(null);
          }}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: COLORS.bg },
            headerTintColor: COLORS.text,
            contentStyle: { backgroundColor: COLORS.bg },
          }}
        >
          <Stack.Screen name="Watch" options={{ headerShown: false }}>
            {(props) => <Watch {...props} session={session} />}
          </Stack.Screen>
          <Stack.Screen name="Link" options={{ title: 'Link a ward' }}>
            {(props) => <Link {...props} session={session} />}
          </Stack.Screen>
          <Stack.Screen
            name="History"
            component={WardHistory}
            options={({ route }) => ({ title: route.params?.name ?? 'History' })}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

/**
 * Past incidents for a ward.
 *
 * Read from guardian_incident_history, a view that simply does not have
 * a medical_snapshot column. Once an incident closes there is no path
 * through which a guardian can reach the medical record at all.
 */
function WardHistory({ route }) {
  const [rows, setRows] = useState([]);
  const wardId = route.params?.wardId;

  useEffect(() => {
    supabase
      .from(TABLES.guardianIncidentHistory)
      .select('*')
      .eq('user_id', wardId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setRows(data ?? []));
  }, [wardId]);

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 22 }}>
      {rows.map((r) => (
        <View
          key={r.id}
          style={[
            S.card,
            { marginBottom: 10, borderColor: r.type === 'medical' ? COLORS.amber : COLORS.border },
          ]}
        >
          <View style={[S.row, { justifyContent: 'space-between' }]}>
            <Text
              style={{
                color: r.type === 'medical' ? COLORS.amber : COLORS.rose,
                fontWeight: '900',
                fontSize: 11,
                letterSpacing: 1.4,
              }}
            >
              {r.type === 'medical' ? 'MEDICAL' : 'SAFETY'}
            </Text>
            <Text style={[S.pillText, { color: statusTone(r.status) }]}>
              {statusLabel(r.status)}
            </Text>
          </View>
          <Text style={[S.h2, { marginTop: 4 }]}>{r.public_ref}</Text>
          <Text style={S.body}>{triggerLabel(r.trigger_reason)}</Text>
          <Text style={S.small}>{formatDateTime(r.created_at)}</Text>
          {r.resolution_note ? (
            <Text style={[S.small, { marginTop: 6, color: COLORS.textMuted }]}>
              {r.resolution_note}
            </Text>
          ) : null}
        </View>
      ))}
      {rows.length === 0 && <Text style={S.small}>No past alerts.</Text>}
    </ScrollView>
  );
}
