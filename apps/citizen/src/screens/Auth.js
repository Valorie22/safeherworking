import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, S } from '../lib/ui';

/**
 * Sign in.
 *
 * Phone + OTP is the designed path — a safety app should not depend on
 * someone remembering an email password during an emergency. Email sign
 * in is kept alongside it because OTP needs a configured SMS provider,
 * and the demo has to work on a table with no carrier in the loop.
 */
export default function Auth() {
  const [mode, setMode] = useState('phone'); // 'phone' | 'email'
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('priya@safeher.demo');
  const [password, setPassword] = useState('SafeHer@123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function sendOtp() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) setError(error.message);
    else setSent(true);
    setBusy(false);
  }

  async function verifyOtp() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (error) setError(error.message);
    setBusy(false);
  }

  async function emailAuth(signUp) {
    setBusy(true);
    setError(null);
    // Call these as methods, never detach them into a variable first.
    // supabase.auth's methods rely on `this`, so `const fn =
    // supabase.auth.signInWithPassword` loses it and every call dies with
    // "Cannot read properties of undefined (reading 'fetch')".
    const { error } = signUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 24, paddingTop: 80 }}>
      <Text style={[S.h1, { fontSize: 40 }]}>
        Safe<Text style={{ color: COLORS.rose }}>Her</Text>
      </Text>
      <Text style={[S.body, { marginTop: 8, marginBottom: 28 }]}>
        Your identity, your medical record and your circle — ready before anything goes wrong.
      </Text>

      <View style={[S.row, { gap: 8, marginBottom: 18 }]}>
        <Tab active={mode === 'phone'} onPress={() => setMode('phone')} label="Phone" />
        <Tab active={mode === 'email'} onPress={() => setMode('email')} label="Email" />
      </View>

      {mode === 'phone' ? (
        <View style={{ gap: 12 }}>
          <View>
            <Text style={S.label}>Mobile number</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              editable={!sent}
              placeholderTextColor={COLORS.textFaint}
              style={[S.input, { marginTop: 6 }]}
            />
          </View>

          {sent && (
            <View>
              <Text style={S.label}>6-digit code</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                style={[S.input, { marginTop: 6, letterSpacing: 8, fontSize: 22 }]}
              />
            </View>
          )}

          <Pressable style={S.btn} onPress={sent ? verifyOtp : sendOtp} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={COLORS.onAccent} />
            ) : (
              <Text style={S.btnText}>{sent ? 'Verify' : 'Send code'}</Text>
            )}
          </Pressable>

          {sent && (
            <Pressable onPress={() => setSent(false)}>
              <Text style={[S.small, { textAlign: 'center' }]}>Change number</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <View>
            <Text style={S.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={[S.input, { marginTop: 6 }]}
            />
          </View>
          <View>
            <Text style={S.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={[S.input, { marginTop: 6 }]}
            />
          </View>

          <Pressable style={S.btn} onPress={() => emailAuth(false)} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={COLORS.onAccent} />
            ) : (
              <Text style={S.btnText}>Sign in</Text>
            )}
          </Pressable>
          <Pressable style={S.btnGhost} onPress={() => emailAuth(true)} disabled={busy}>
            <Text style={S.btnGhostText}>Create an account</Text>
          </Pressable>

          <Text style={[S.small, { marginTop: 4, lineHeight: 17 }]}>
            Demo accounts: priya@safeher.demo / ananya@safeher.demo — password SafeHer@123.
          </Text>
        </View>
      )}

      {error && (
        <Text style={{ color: COLORS.critical, marginTop: 16, fontSize: 13 }}>{error}</Text>
      )}
    </ScrollView>
  );
}

function Tab({ active, onPress, label }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? COLORS.rose : COLORS.border,
        backgroundColor: active ? 'rgba(255,77,141,0.14)' : 'transparent',
      }}
    >
      <Text style={{ color: active ? COLORS.rose : COLORS.textFaint, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}
