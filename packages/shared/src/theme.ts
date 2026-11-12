/**
 * SafeHer — the shared palette.
 *
 * WHY IT LOOKS LIKE THIS
 * SafeHer is a women's safety product, so the surface reads warm and
 * feminine rather than like generic blue-slate security software: the
 * base is a deep aubergine, the primary is rose, the secondary is lilac.
 *
 * But it also has to survive a 1920x1080 control-room screen that a tired
 * operator stares at for eight hours, so the warmth is carried by the
 * *hue* of the dark surfaces, not by brightness. Every text colour here
 * clears WCAG AA against its intended background, and the three alert
 * colours (rose / amber / mint) are distinguishable under the most common
 * form of colour blindness because they differ in lightness as well as
 * hue — an operator must never have to rely on hue alone to tell a
 * SAFETY alert from a MEDICAL one.
 *
 * One accent per state. Never two roses on one screen meaning two things.
 */

export const COLORS = {
  // ---- surfaces: deep aubergine, warm rather than neutral ----
  bg: '#140A18',
  bgDeep: '#0C050F',
  surface: '#1E1023',
  surfaceAlt: '#2A1730',
  surfaceHi: '#361E3E',
  border: '#3D2145',
  borderSoft: '#2B1832',

  // ---- type ----
  text: '#FBEFF6',
  textMuted: '#C9AAC6',
  textFaint: '#8C6E8E',
  onAccent: '#1A0620',

  // ---- brand ----
  rose: '#FF4D8D', // SafeHer primary · SAFETY SOS
  roseDeep: '#D6246A',
  roseSoft: '#FFD6E7',
  roseGlow: 'rgba(255, 77, 141, 0.28)',

  lilac: '#C08CF5', // secondary · guardian / Circle
  lilacDeep: '#8B5CF6',
  lilacSoft: '#E9D9FF',

  // ---- semantic ----
  amber: '#FFB020', // MEDICAL SOS
  amberSoft: '#FFE3A8',
  amberGlow: 'rgba(255, 176, 32, 0.26)',

  mint: '#3DDC97', // safe · resolved
  mintSoft: '#B8F2D8',

  sky: '#5BC8FF', // info · journey · en route
  skySoft: '#CCEEFF',

  critical: '#FF3B5C',
  grey: '#6B5A70',
} as const;

/** Type badge colour. Safety is rose, medical is amber — never swapped. */
export const typeColor = (type: 'safety' | 'medical'): string =>
  type === 'medical' ? COLORS.amber : COLORS.rose;

export const severityColor = (
  severity: 'low' | 'medium' | 'high' | 'critical' | null | undefined,
): string => {
  switch (severity) {
    case 'low':
      return COLORS.mint;
    case 'medium':
      return COLORS.amber;
    case 'critical':
      return COLORS.critical;
    case 'high':
    default:
      return COLORS.rose;
  }
};

export const statusColor = (status: string | null | undefined): string => {
  switch (status) {
    case 'new':
      return COLORS.rose;
    case 'acknowledged':
      return COLORS.lilac;
    case 'assigned':
    case 'dispatched':
      return COLORS.sky;
    case 'enroute':
    case 'onscene':
      return COLORS.amber;
    case 'resolved':
      return COLORS.mint;
    case 'false_alarm':
      return COLORS.grey;
    default:
      return COLORS.textFaint;
  }
};

/** Human label for a status pill. */
export const statusLabel = (status: string | null | undefined): string =>
  ({
    new: 'NEW',
    acknowledged: 'ACKNOWLEDGED',
    assigned: 'ASSIGNED',
    dispatched: 'DISPATCHED',
    enroute: 'EN ROUTE',
    onscene: 'ON SCENE',
    resolved: 'RESOLVED',
    false_alarm: 'FALSE ALARM',
  })[status ?? ''] ?? String(status ?? '—').toUpperCase();

/**
 * The same tokens as CSS custom properties, so the web app styles from
 * one source instead of re-typing hex codes into Tailwind config.
 */
export function cssVariables(): string {
  const lines = Object.entries(COLORS).map(
    ([k, v]) => `  --sh-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v};`,
  );
  return `:root {\n${lines.join('\n')}\n}`;
}

export const FONT_STACK =
  '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif';

/** Tabular figures matter for a ticking age counter — it must not jitter. */
export const MONO_STACK =
  '"JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace';
