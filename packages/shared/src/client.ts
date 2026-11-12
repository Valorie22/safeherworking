import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * One client factory for all four surfaces.
 *
 * The web apps use the browser's localStorage; the Expo apps pass in
 * AsyncStorage. Everything else — realtime tuning, auth persistence —
 * is identical, which is what keeps behaviour consistent when you are
 * looking at three screens at once and trying to work out which one is
 * lying to you.
 */

export interface CreateClientOptions {
  url: string;
  anonKey: string;
  /** AsyncStorage on React Native; omit on web to use localStorage. */
  storage?: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  };
  /** React Native cannot detect a session in a URL — pass false there. */
  detectSessionInUrl?: boolean;
}

export function createClient(opts: CreateClientOptions): SupabaseClient {
  const { url, anonKey, storage, detectSessionInUrl = true } = opts;

  if (!url || !anonKey) {
    throw new Error(
      'SafeHer: missing Supabase url or anon key. Check your .env — ' +
        'EXPO_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL.',
    );
  }

  return createSupabaseClient(url, anonKey, {
    // Hand supabase-js the platform's own fetch explicitly.
    //
    // Left to itself it tries to resolve one, and under react-native-web
    // that resolution picks up a node-fetch shim that is not actually
    // there — every request then dies with "Cannot read properties of
    // undefined (reading 'fetch')". Passing it directly costs nothing on
    // native and makes the same client work in a browser, which is what
    // lets the guardian app run on a laptop as a second device.
    global: {
      fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    },
    auth: {
      storage: storage as never,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl,
    },
    realtime: {
      params: {
        // Breadcrumbs arrive every 5s per incident and a busy wall may
        // have a dozen open at once. 20/s is comfortable headroom.
        eventsPerSecond: 20,
      },
    },
  });
}

export type { SupabaseClient };
