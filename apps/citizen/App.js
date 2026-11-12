import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from './src/lib/supabase';
import { COLORS } from './src/lib/ui';
import { TABLES } from '@safeher/shared';
import { raiseSos } from './src/lib/sos';
import { flushQueue } from './src/lib/offline';

import Auth from './src/screens/Auth';
import Onboarding from './src/screens/Onboarding';
import Home from './src/screens/Home';
import ActiveIncident from './src/screens/ActiveIncident';
import Journey from './src/screens/Journey';
import Guardians from './src/screens/Guardians';
import Profile from './src/screens/Profile';
import History from './src/screens/History';
import Shadow from './src/screens/Shadow';

const Stack = createNativeStackNavigator();

const navTheme = {
  dark: true,
  colors: {
    primary: COLORS.rose,
    background: COLORS.bg,
    card: COLORS.surface,
    text: COLORS.text,
    border: COLORS.border,
    notification: COLORS.rose,
  },
};

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(undefined); // undefined = not checked yet
  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);

  // Shadow mode. The app opens as a calculator; one PIN unlocks it, a
  // different one unlocks it *and* raises a silent alert.
  const [locked, setLocked] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setProfile(undefined);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Onboarding is mandatory: no profile means no medical record, and an
  // SOS without a medical record is the thing this product exists to fix.
  useEffect(() => {
    if (!session) return;
    supabase
      .from(TABLES.profiles)
      .select('id')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data ?? null));

    // Anything raised while offline syncs the moment we have a session.
    flushQueue().catch(() => {});
  }, [session]);

  // Rejoin an incident that is still open — closing the app must not
  // abandon an active emergency.
  useEffect(() => {
    if (!session || !profile) return;
    supabase
      .from(TABLES.incidents)
      .select('*')
      .eq('user_id', session.user.id)
      .not('status', 'in', '(resolved,false_alarm)')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) setIncident(data[0]);
      });
  }, [session, profile]);

  async function fireDuress() {
    // Unlock exactly as the normal PIN does — identical, observable
    // behaviour — and raise a silent incident in the background.
    setLocked(false);
    const result = await raiseSos({
      type: 'safety',
      reason: 'duress',
      silent: true,
    });
    // Deliberately NOT shown. A duress alert that announces itself is a
    // duress alert that gets you hurt.
    if (result.incident) setIncident(result.incident);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.rose} />
      </View>
    );
  }

  if (locked) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Shadow onUnlock={() => setLocked(false)} onDuress={fireDuress} />
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
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: COLORS.bg },
          }}
        >
          {!session ? (
            <Stack.Screen name="Auth" component={Auth} options={{ headerShown: false }} />
          ) : profile === null ? (
            <Stack.Screen name="Onboarding" options={{ headerShown: false }}>
              {(props) => (
                <Onboarding
                  {...props}
                  session={session}
                  onDone={() => setProfile({ id: session.user.id })}
                />
              )}
            </Stack.Screen>
          ) : incident && !incident.silent ? (
            // A live incident takes the whole app — except a silent one,
            // which must leave the phone looking completely untouched.
            <Stack.Screen name="Active" options={{ headerShown: false }}>
              {(props) => (
                <ActiveIncident
                  {...props}
                  incident={incident}
                  session={session}
                  onResolved={() => setIncident(null)}
                />
              )}
            </Stack.Screen>
          ) : (
            <>
              <Stack.Screen name="Home" options={{ headerShown: false }}>
                {(props) => (
                  <Home {...props} session={session} onIncident={setIncident} />
                )}
              </Stack.Screen>
              <Stack.Screen name="Journey" options={{ title: 'Journey' }}>
                {(props) => (
                  <Journey {...props} session={session} onIncident={setIncident} />
                )}
              </Stack.Screen>
              <Stack.Screen name="Guardians" options={{ title: 'Guardians' }}>
                {(props) => <Guardians {...props} session={session} />}
              </Stack.Screen>
              <Stack.Screen name="Profile" options={{ title: 'Profile' }}>
                {(props) => <Profile {...props} session={session} />}
              </Stack.Screen>
              <Stack.Screen name="History" options={{ title: 'History' }}>
                {(props) => <History {...props} session={session} />}
              </Stack.Screen>
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
