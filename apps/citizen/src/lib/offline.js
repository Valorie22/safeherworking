import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SMS from 'expo-sms';
import { supabase } from './supabase';
import { RPC, TABLES } from '@safeher/shared';

/**
 * The offline path.
 *
 * Honest about what it is: with no data connection, SMS reaches the
 * guardians but NOT the control room. The queued incident syncs the
 * moment connectivity returns. We tell the user which path actually went
 * out rather than showing a reassuring tick that means nothing.
 */

const QUEUE_KEY = 'safeher.sos.queue';

export async function queueSos(args) {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    queue.push({ args, queuedAt: new Date().toISOString() });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return queue.length;
  } catch {
    return 0;
  }
}

export async function queueLength() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw).length : 0;
  } catch {
    return 0;
  }
}

/** Drain the queue. Safe to call often — it no-ops when empty. */
export async function flushQueue() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return { sent: 0 };
  const queue = JSON.parse(raw);
  if (queue.length === 0) return { sent: 0 };

  const remaining = [];
  let sent = 0;

  for (const item of queue) {
    const { data, error } = await supabase.rpc(RPC.raiseSos, item.args);
    if (error || !data) {
      remaining.push(item);
      continue;
    }
    sent++;
    // Record that this alert was delayed, and by how long — a control
    // room reading the timeline must not think it arrived instantly.
    await supabase.from(TABLES.incidentEvents).insert({
      incident_id: data.id,
      actor_type: 'system',
      kind: 'sos.status',
      message: `Raised offline at ${item.queuedAt}, synced on reconnect`,
      payload: { queued_at: item.queuedAt, delayed_ms: Date.now() - +new Date(item.queuedAt) },
    });
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { sent, remaining: remaining.length };
}

/**
 * SMS to tier-1 guardians. This is the only channel that works with no
 * data at all, so it is the last line — not a nicety.
 *
 * expo-sms opens the composer rather than sending silently; the OS does
 * not permit a background send without a native module and carrier
 * agreement, and pretending otherwise would be dishonest. The message is
 * pre-filled and one tap away.
 */
export async function smsFallback(args) {
  try {
    const available = await SMS.isAvailableAsync();
    if (!available) return { sent: false, reason: 'no_sms' };

    const { data: session } = await supabase.auth.getUser();
    const uid = session?.user?.id;
    if (!uid) return { sent: false, reason: 'no_session' };

    // Cached at onboarding so this works with no network.
    const raw = await AsyncStorage.getItem('safeher.guardians.tier1');
    const numbers = raw ? JSON.parse(raw) : [];
    if (numbers.length === 0) return { sent: false, reason: 'no_guardians' };

    const where =
      args.p_lat != null
        ? `https://maps.google.com/?q=${args.p_lat},${args.p_lng}`
        : 'location unavailable';

    const body =
      `SafeHer EMERGENCY (${args.p_type.toUpperCase()}). ` +
      `I need help. Last known location: ${where}. ` +
      `Sent offline — the control room may not have this yet.`;

    const { result } = await SMS.sendSMSAsync(numbers, body);
    return { sent: result === 'sent', result, recipients: numbers.length };
  } catch {
    return { sent: false, reason: 'error' };
  }
}

/** Cache tier-1 guardian numbers so the SMS path works with no network. */
export async function cacheTier1Guardians(userId) {
  const { data } = await supabase
    .from(TABLES.guardians)
    .select('phone, tier, status')
    .eq('user_id', userId)
    .eq('tier', 1);
  const numbers = (data ?? []).map((g) => g.phone).filter(Boolean);
  await AsyncStorage.setItem('safeher.guardians.tier1', JSON.stringify(numbers));
  return numbers;
}
