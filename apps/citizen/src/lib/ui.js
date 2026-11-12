import { StyleSheet } from 'react-native';
import { COLORS } from '@safeher/shared';

/**
 * SafeHer's phone styles, built from the same palette the control room
 * uses. Dark aubergine, rose primary, high contrast — and everything
 * important sits in the lower two-thirds so it is reachable one-handed.
 */
export { COLORS };

export const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  pad: { paddingHorizontal: 20 },

  h1: { color: COLORS.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  h2: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  body: { color: COLORS.textMuted, fontSize: 15, lineHeight: 21 },
  small: { color: COLORS.textFaint, fontSize: 12 },
  label: {
    color: COLORS.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },

  input: {
    backgroundColor: COLORS.bgDeep,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: COLORS.text,
    fontSize: 16,
  },

  btn: {
    backgroundColor: COLORS.rose,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: { color: COLORS.onAccent, fontWeight: '800', fontSize: 16 },

  btnGhost: {
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnGhostText: { color: COLORS.textMuted, fontWeight: '700', fontSize: 15 },

  row: { flexDirection: 'row', alignItems: 'center' },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
});

export function statusTone(status) {
  return (
    {
      new: COLORS.rose,
      acknowledged: COLORS.lilac,
      assigned: COLORS.sky,
      dispatched: COLORS.sky,
      enroute: COLORS.amber,
      onscene: COLORS.amber,
      resolved: COLORS.mint,
      false_alarm: COLORS.grey,
    }[status] ?? COLORS.textFaint
  );
}
