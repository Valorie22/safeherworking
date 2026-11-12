import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, preTriggerLabel } from '@safeher/shared';
import type { IncidentMedia, IncidentWithProfile } from '@safeher/shared';
import { signedUrl } from '../../lib/supabase';
import { Panel } from '../DetailPane';

/**
 * The live feed.
 *
 * The pre-trigger clips are the point of the whole product: audio that
 * was already being recorded before anyone pressed anything. They are
 * separated above the line and labelled with how far before the alert
 * they were captured, because "captured 40s BEFORE the alert" is the
 * sentence that makes an examiner sit up.
 */
export default function LiveFeedPanel({
  incident,
  media,
}: {
  incident: IncidentWithProfile;
  media: IncidentMedia[];
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [autoplay, setAutoplay] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playedRef = useRef<Set<string>>(new Set());

  const audio = useMemo(
    () =>
      media
        .filter((m) => m.kind === 'audio')
        .sort((a, b) => +new Date(a.captured_at) - +new Date(b.captured_at)),
    [media],
  );
  const pre = audio.filter((m) => m.before_trigger);
  const post = audio.filter((m) => !m.before_trigger);
  const photos = useMemo(
    () =>
      media
        .filter((m) => m.kind === 'photo')
        .sort((a, b) => +new Date(b.captured_at) - +new Date(a.captured_at)),
    [media],
  );

  // Mint a signed URL per object as it arrives. The bucket is private —
  // the signature is only granted because storage RLS let us read it.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const m of media) {
        if (urls[m.id]) continue;
        const u = await signedUrl(m.storage_path);
        if (!alive || !u) continue;
        setUrls((prev) => ({ ...prev, [m.id]: u }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  // Play clips back to back, oldest first, so the officer hears the scene
  // continuously without clicking anything.
  useEffect(() => {
    if (!autoplay || playing) return;
    const next = audio.find((m) => !playedRef.current.has(m.id) && urls[m.id]);
    if (!next) return;
    playedRef.current.add(next.id);
    setPlaying(next.id);
    const el = new Audio(urls[next.id]);
    audioRef.current = el;
    el.onended = () => setPlaying(null);
    el.onerror = () => setPlaying(null);
    void el.play().catch(() => setPlaying(null));
  }, [audio, urls, autoplay, playing]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  function playOne(m: IncidentMedia) {
    audioRef.current?.pause();
    const url = urls[m.id];
    if (!url) return;
    const el = new Audio(url);
    audioRef.current = el;
    setPlaying(m.id);
    el.onended = () => setPlaying(null);
    void el.play().catch(() => setPlaying(null));
  }

  return (
    <Panel
      title="Live feed"
      right={
        <label className="flex items-center gap-1.5 text-[10px] text-sh-muted cursor-pointer">
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(e) => setAutoplay(e.target.checked)}
            className="accent-[#FF4D8D]"
          />
          auto-play
        </label>
      }
    >
      {audio.length === 0 && photos.length === 0 && (
        <p className="text-sh-faint text-xs">No media yet. Clips appear as they upload.</p>
      )}

      {pre.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-sh-lilac">
              Sealed from the rolling buffer
            </span>
            <span className="flex-1 h-px bg-sh-lilac/30" />
          </div>
          <div className="space-y-1">
            {pre.map((m) => (
              <Clip
                key={m.id}
                m={m}
                url={urls[m.id]}
                playing={playing === m.id}
                onPlay={() => playOne(m)}
                label={preTriggerLabel(m.captured_at, incident.created_at)}
                tone="pre"
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="flex-1 h-px bg-sh-rose/40" />
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-sh-rose">
              SOS pressed · {formatClock(incident.created_at)}
            </span>
            <span className="flex-1 h-px bg-sh-rose/40" />
          </div>
        </div>
      )}

      {post.length > 0 && (
        <div className="space-y-1">
          {post.map((m) => (
            <Clip
              key={m.id}
              m={m}
              url={urls[m.id]}
              playing={playing === m.id}
              onPlay={() => playOne(m)}
              label={formatClock(m.captured_at)}
              tone="live"
            />
          ))}
        </div>
      )}

      {photos.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] uppercase tracking-[0.18em] text-sh-faint mb-1">
            Snapshots · newest first
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {photos.map((m) =>
              urls[m.id] ? (
                <button
                  key={m.id}
                  onClick={() => setEnlarged(urls[m.id])}
                  className="shrink-0 relative group"
                  title={formatClock(m.captured_at)}
                >
                  <img
                    src={urls[m.id]}
                    alt=""
                    className="w-24 h-18 object-cover rounded-md border border-sh-border
                               group-hover:border-sh-rose transition"
                  />
                  <span className="absolute bottom-0 inset-x-0 text-[8px] tabular bg-sh-bg-deep/80 text-sh-muted px-1">
                    {formatClock(m.captured_at)}
                  </span>
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}

      {enlarged && (
        <div
          className="fixed inset-0 z-50 bg-black/85 grid place-items-center p-8 cursor-zoom-out"
          onClick={() => setEnlarged(null)}
        >
          <img src={enlarged} alt="" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </Panel>
  );
}

function Clip({
  m,
  url,
  playing,
  onPlay,
  label,
  tone,
}: {
  m: IncidentMedia;
  url?: string;
  playing: boolean;
  onPlay: () => void;
  label: string;
  tone: 'pre' | 'live';
}) {
  const isPre = tone === 'pre';
  return (
    <button
      onClick={onPlay}
      disabled={!url}
      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 border text-left transition
        ${
          isPre
            ? 'bg-sh-lilac/8 border-sh-lilac/40 hover:border-sh-lilac'
            : 'bg-sh-surface-alt/60 border-sh-border-soft hover:border-sh-rose/50'
        }
        ${playing ? 'ring-1 ring-sh-rose' : ''} disabled:opacity-40`}
    >
      <span className={`text-sm ${playing ? 'text-sh-rose' : isPre ? 'text-sh-lilac' : 'text-sh-muted'}`}>
        {playing ? '❚❚' : '▶'}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[11px] truncate ${isPre ? 'text-sh-lilac-soft font-semibold' : 'text-sh-muted'}`}>
          {label}
        </span>
      </span>
      {m.duration_ms != null && (
        <span className="tabular text-[10px] text-sh-faint">
          {(m.duration_ms / 1000).toFixed(0)}s
        </span>
      )}
    </button>
  );
}
