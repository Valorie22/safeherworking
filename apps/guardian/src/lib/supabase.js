import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@safeher/shared';

/**
 * SafeHer Circle's Supabase client — the same factory as the other three
 * surfaces, so auth, realtime and retry behaviour are identical.
 */
export const supabase = createClient({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  storage: AsyncStorage,
  detectSessionInUrl: false,
});
