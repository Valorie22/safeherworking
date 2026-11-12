import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, S } from '../lib/ui';
import { TABLES } from '@safeher/shared';

/**
 * Claim an invite code.
 *
 * The guardian may only set linked_profile_id to themselves, and only on
 * a row that is still pending — enforced by the guardians_claim_invite
 * policy, not by this screen. Guessing someone else's code still gets
 * you nothing but your own name on a row they can revoke.
 */
export default function Link({ navigation, session }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function claim() {
    const value = code.trim().toUpperCase();
    if (!value) return;
    setBusy(true);

    const { data, error } = await supabase
      .from(TABLES.guardians)
      .update({ linked_profile_id: session.user.id, status: 'active' })
      .eq('invite_code', value)
      .eq('status', 'pending')
      .select();

    setBusy(false);

    if (error) return Alert.alert('Could not link', error.message);
    if (!data || data.length === 0) {
      return Alert.alert(
        'That code did not work',
        'It may have been used already, or revoked. Ask them to generate a new one from SafeHer → Guardians.',
      );
    }

    Alert.alert('Linked', `You are now watching over ${data[0].name ? 'them' : 'your ward'}.`);
    navigation.goBack();
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 22, paddingTop: 40 }}>
      <Text style={S.h1}>Link a ward</Text>
      <Text style={[S.body, { marginTop: 6 }]}>
        Enter the invite code from their SafeHer app. They stay in control — they can revoke
        your access whenever they want, and you will be told.
      </Text>

      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder="SAFE-0000"
        placeholderTextColor={COLORS.textFaint}
        style={[
          S.input,
          {
            marginTop: 28,
            fontSize: 26,
            letterSpacing: 6,
            textAlign: 'center',
            paddingVertical: 20,
            borderColor: COLORS.lilac,
          },
        ]}
      />

      <Pressable
        style={[S.btn, { marginTop: 20, backgroundColor: COLORS.lilac }]}
        onPress={claim}
        disabled={busy}
      >
        <Text style={[S.btnText, { color: '#1A0620' }]}>{busy ? 'Linking…' : 'Link'}</Text>
      </Pressable>

      <View style={[S.card, { marginTop: 30 }]}>
        <Text style={S.label}>What you will and will not see</Text>
        <Text style={[S.body, { marginTop: 8 }]}>✓ Their live alerts, the instant one is raised</Text>
        <Text style={S.body}>✓ Their location and the trail, during an emergency</Text>
        <Text style={S.body}>✓ Their journey check-in countdown</Text>
        <Text style={[S.body, { marginTop: 8, color: COLORS.textFaint }]}>
          ✗ Their medical record, except while an emergency is open
        </Text>
        <Text style={{ color: COLORS.textFaint, fontSize: 15 }}>
          ✗ Their day-to-day location when nothing is wrong
        </Text>
      </View>
    </ScrollView>
  );
}
