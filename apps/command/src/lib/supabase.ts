import { createClient } from '@safeher/shared';
import type { Responder } from '@safeher/shared';
import { useEffect, useState } from 'react';

// Each browser tab keeps its own sign-in. Command (/) and Med (/med) are
// served from the same origin, so with the default shared localStorage
// session (and supabase-js's cross-tab BroadcastChannel) signing in as a
// medic in one tab signed every tab in as that medic — and the role
// redirect then sent the police tab to /med. sessionStorage is per tab and
// survives reloads; the per-tab key gives each tab its own channel too.
function tabStorageKey(): string {
  const ID_KEY = 'safeher-tab-id';
  let id = sessionStorage.getItem(ID_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(ID_KEY, id);
  }
  return `safeher-command-auth-${id}`;
}

export const supabase = createClient({
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  storage: {
    getItem: async (k) => sessionStorage.getItem(k),
    setItem: async (k, v) => sessionStorage.setItem(k, v),
    removeItem: async (k) => sessionStorage.removeItem(k),
  },
  storageKey: tabStorageKey(),
});

/**
 * The signed-in responder. Their role is what decides the entire view:
 * dispatcher/officer see their own station, a supervisor sees the whole
 * city, a medic lands in /med. Nothing about that is a client-side
 * preference — RLS enforces the same split server-side.
 */
export function useResponder() {
  const [loading, setLoading] = useState(true);
  const [responder, setResponder] = useState<Responder | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load(userId: string | undefined, mail: string | null) {
      if (!userId) {
        if (alive) {
          setResponder(null);
          setEmail(null);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from('responders')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (alive) {
        setResponder((data as Responder) ?? null);
        setEmail(mail);
        setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      load(data.session?.user?.id, data.session?.user?.email ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setLoading(true);
      load(session?.user?.id, session?.user?.email ?? null);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { loading, responder, email };
}

export const isMedicalRole = (r: Responder | null) =>
  r?.role === 'medic' || r?.role === 'paramedic';

/**
 * Evidence lives in a private bucket. A signed URL is only issued because
 * the storage policy let the object be read in the first place, which in
 * turn defers to can_see_incident(). So this cannot leak another
 * station's media even if the path were guessed.
 */
export async function signedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('incident-media')
    .createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}
