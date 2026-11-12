import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { unlockAudio } from '../lib/audio';

const DEMO = [
  { label: 'Dispatcher — Sector 17', email: 'dispatcher@safeher.demo', tint: 'sh-rose' },
  { label: 'Officer — Sector 14', email: 'officer@safeher.demo', tint: 'sh-rose' },
  { label: 'Supervisor — city wide', email: 'supervisor@safeher.demo', tint: 'sh-lilac' },
  // Sector 16 is the hospital nearest the demo's SOS location, so this is
  // the medic who actually receives it. Listed first of the medical
  // accounts for that reason.
  { label: 'Medic — Sector 16  ← for the demo', email: 'medic16@safeher.demo', tint: 'sh-amber' },
  { label: 'Medic — PGIMER', email: 'medic@safeher.demo', tint: 'sh-amber' },
  { label: 'Paramedic — GMCH 32', email: 'paramedic@safeher.demo', tint: 'sh-amber' },
];

export default function Login() {
  const [email, setEmail] = useState('dispatcher@safeher.demo');
  const [password, setPassword] = useState('SafeHer@123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Browsers will not play the alert tone until a user gesture has
    // unlocked audio. The login click is the only gesture we are
    // guaranteed to get, so we spend it here.
    unlockAudio();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="h-full grid place-items-center p-6">
      <div className="w-full max-w-[26rem]">
        <div className="mb-8">
          <div className="flex items-baseline gap-2">
            <h1 className="text-4xl font-extrabold tracking-tight">
              Safe<span className="text-sh-rose">Her</span>
            </h1>
            <span className="text-sh-faint text-sm font-medium tracking-[0.2em] uppercase">
              Command
            </span>
          </div>
          <p className="text-sh-muted text-sm mt-2">
            Control-room access. Your role decides what you see.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="bg-sh-surface border border-sh-border rounded-2xl p-6 space-y-4"
        >
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-sh-faint">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full bg-sh-bg border border-sh-border rounded-lg px-3 py-2.5
                         text-sh-text placeholder:text-sh-faint"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wider text-sh-faint">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full bg-sh-bg border border-sh-border rounded-lg px-3 py-2.5
                         text-sh-text placeholder:text-sh-faint"
            />
          </label>

          {error && (
            <p className="text-sh-critical text-sm bg-sh-critical/10 border border-sh-critical/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-sh-rose text-[#1A0620] font-bold rounded-lg py-3
                       hover:bg-sh-rose-soft transition disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-wider text-sh-faint mb-2">Demo accounts</p>
          <div className="grid gap-1.5">
            {DEMO.map((d) => (
              <button
                key={d.email}
                onClick={() => {
                  setEmail(d.email);
                  setPassword('SafeHer@123');
                }}
                className="text-left text-sm bg-sh-surface/60 border border-sh-border-soft
                           hover:border-sh-rose/60 rounded-lg px-3 py-2 transition
                           flex items-center justify-between gap-3"
              >
                <span className="text-sh-muted">{d.label}</span>
                <span className="text-sh-faint text-xs font-mono">{d.email}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-sh-faint mt-3">
            All demo passwords are <span className="font-mono text-sh-muted">SafeHer@123</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
