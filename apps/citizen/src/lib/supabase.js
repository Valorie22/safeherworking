import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@safeher/shared';

/**
 * The citizen app's Supabase client.
 *
 * EXPO_PUBLIC_SUPABASE_URL must be your machine's LAN address when you
 * are running against a local stack — a phone cannot reach your laptop's
 * 127.0.0.1, and this is the single most common reason the demo "doesn't
 * work" on a real device.
 */
export const supabase = createClient({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  storage: AsyncStorage,
  detectSessionInUrl: false,
});
