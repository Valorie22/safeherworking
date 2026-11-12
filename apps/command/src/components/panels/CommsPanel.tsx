import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock } from '@safeher/shared';
import type { IncidentMessage, IncidentWithProfile, Responder } from '@safeher/shared';
import { signedUrl } from '../../lib/supabase';
import { PushToTalk } from '../../lib/audio';
import { sendText } from '../../lib/actions';
import type { IncidentDetail } from '../../lib/useIncidentDetail';
import { Panel } from '../DetailPane';

/**
 * In-ecosystem comms.
 *
 * THERE IS NO PHONE NUMBER IN THIS PANEL. That is deliberate and it is
 * the single most important design decision in the product: the officer
 * already has her identity, her medical record, her location and her
 * audio, so handing them a number to dial would be a step backwards.
 * Do not add one.
 */
export default function CommsPanel({
  incident,
  detail,
  responder,
}: {
  incident: IncidentWithProfile;
  detail: IncidentDetail;
  responder: Responder;
}) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const ptt = useRef(new PushToTalk());
  const scroller = useRef<HTMLDivElement>(null);

  // guardian.context messages are the app's killer feature — family
  // context beats any sensor — so they must be visually unmistakable.
  const thread = useMemo(() => {
    const ctxEvents = detail.events
      .filter((e) => e.kind === 'guardian.context' || e.kind === 'guardian.acknowledged')
      .map((e) => ({
        id: `ev-${e.id}`,
        sender_role: 'guardian' as const,
        sender_id: e.actor_id,
        body: e.message,
        audio_path: null,
        at: e.at,
        isEvent: true,
        kind: e.kind,
      }));
    const msgs = detail.messages.map((m) => ({ ...m, isEvent: false, kind: 'sos.message' }));
    return [...msgs, ...ctxEvents].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  }, [detail.messages, detail.events]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [thread.length]);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const m of detail.messages) {
        if (!m.audio_path || urls[m.id]) continue;
        const u = await signedUrl(m.audio_path);
        if (alive && u) setUrls((p) => ({ ...p, [m.id]: u }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.messages]);

  async function startPtt() {
    if (recording) return;
    try {
      await ptt.current.start();
      setRecording(true);
    } catch {
      alert('Microphone permission is required for push-to-talk.');
    }
  }

  async function stopPtt() {
    if (!recording) return;
    setRecording(false);
    setSending(true);
    await ptt.current.stopAndSend(incident.id, responder.id);
    setSending(false);
  }

  // Space is hold-to-talk, per the keyboard contract in §8.
  useEffect(() => {
    function down(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        void startPtt();
      }
    }
    function up(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        void stopPtt();
      }
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, incident.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const body = text;
    setText('');
    await sendText(incident.id, responder.id, body);
  }

  return (
    <Panel title="Comms — in-ecosystem">
      <div ref={scroller} className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
        {thread.length === 0 && (
          <p className="text-sh-faint text-xs">
            No messages yet. Hold <kbd className="px-1 border border-sh-border rounded">Space</kbd>{' '}
            to talk.
          </p>
        )}

        {thread.map((m) => (
          <Bubble key={m.id} m={m as IncidentMessage & { kind: string }} url={urls[m.id]} />
        ))}
      </div>

      <form onSubmit={submit} className="mt-2 flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message to the citizen…"
          className="flex-1 bg-sh-bg border border-sh-border rounded-lg px-2.5 py-2 text-xs"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="text-xs font-semibold px-3 rounded-lg bg-sh-surface-hi border border-sh-border
                     hover:border-sh-rose/60 disabled:opacity-40 transition"
        >
          Send
        </button>
      </form>

      <button
        onMouseDown={startPtt}
        onMouseUp={stopPtt}
        onMouseLeave={() => recording && stopPtt()}
        disabled={sending}
        className={`mt-1.5 w-full rounded-lg py-3 font-bold text-sm transition select-none
          ${
            recording
              ? 'bg-sh-rose text-[#2A0413] scale-[0.99]'
              : 'bg-sh-rose/15 text-sh-rose border border-sh-rose/50 hover:bg-sh-rose/25'
          } disabled:opacity-50`}
      >
        {sending ? 'Sending…' : recording ? '● RECORDING — release to send' : 'HOLD TO TALK (Space)'}
      </button>
    </Panel>
  );
}

function Bubble({ m, url }: { m: IncidentMessage & { kind?: string }; url?: string }) {
  const isGuardian = m.sender_role === 'guardian';
  const isResponder = m.sender_role === 'responder';
  const isContext = m.kind === 'guardian.context';

  const tone = isGuardian
    ? 'bg-sh-lilac/12 border-sh-lilac/50'
    : isResponder
      ? 'bg-sh-sky/10 border-sh-sky/40'
      : 'bg-sh-surface-alt border-sh-border-soft';

  const badge = isGuardian
    ? { text: isContext ? 'FAMILY CONTEXT' : 'GUARDIAN', cls: 'bg-sh-lilac text-[#1A0620]' }
    : isResponder
      ? { text: 'CONTROL ROOM', cls: 'bg-sh-sky text-[#03202B]' }
      : { text: 'CITIZEN', cls: 'bg-sh-rose text-[#2A0413]' };

  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${tone} ${isContext ? 'ring-1 ring-sh-lilac/40' : ''}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[8px] font-extrabold tracking-wider px-1 py-0.5 rounded ${badge.cls}`}>
          {badge.text}
        </span>
        <span className="tabular text-[9px] text-sh-faint ml-auto">{formatClock(m.at)}</span>
      </div>
      {m.body && <p className="text-xs leading-snug">{m.body}</p>}
      {m.audio_path && url && <audio controls src={url} className="w-full h-7 mt-1" />}
      {m.audio_path && !url && <p className="text-[10px] text-sh-faint">loading clip…</p>}
    </div>
  );
}
