import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../lib/ui';

/**
 * An SOS button.
 *
 * Hold 1.2s to arm, then a 3-second countdown you can still cancel.
 * Both stages exist because the two failure modes are opposite: firing
 * by accident in a pocket wastes a real dispatch, and a button that
 * needs a steady thumb is useless to someone being grabbed.
 *
 * The two buttons are deliberately never confusable — different colour,
 * different shape, different label, different position on the screen.
 */
const HOLD_MS = 1200;
const COUNTDOWN_S = 3;

export default function SosButton({ variant, title, subtitle, onFire, disabled }) {
  const medical = variant === 'medical';
  const tint = medical ? COLORS.amber : COLORS.rose;

  const [holding, setHolding] = useState(false);
  const [counting, setCounting] = useState(false);
  const [seconds, setSeconds] = useState(COUNTDOWN_S);

  const fill = useRef(new Animated.Value(0)).current;
  const holdTimer = useRef(null);
  const tickTimer = useRef(null);

  function startHold() {
    if (disabled || counting) return;
    setHolding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.timing(fill, {
      toValue: 1,
      duration: HOLD_MS,
      useNativeDriver: false,
    }).start();
    holdTimer.current = setTimeout(arm, HOLD_MS);
  }

  function cancelHold() {
    if (counting) return;
    setHolding(false);
    clearTimeout(holdTimer.current);
    Animated.timing(fill, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  }

  function arm() {
    setHolding(false);
    setCounting(true);
    setSeconds(COUNTDOWN_S);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }

  function abort() {
    setCounting(false);
    clearInterval(tickTimer.current);
    fill.setValue(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  useEffect(() => {
    if (!counting) return;
    tickTimer.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(tickTimer.current);
          setCounting(false);
          fill.setValue(0);
          onFire();
          return COUNTDOWN_S;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tickTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counting]);

  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
      clearInterval(tickTimer.current);
    },
    [],
  );

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  if (counting) {
    return (
      <View style={[styles.btn, { backgroundColor: tint, borderColor: tint }]}>
        <Text style={[styles.countNum, { color: medical ? '#231400' : '#2A0413' }]}>
          {seconds}
        </Text>
        <Text style={[styles.countLabel, { color: medical ? '#231400' : '#2A0413' }]}>
          SENDING {medical ? 'MEDICAL' : 'SAFETY'} SOS
        </Text>
        <Pressable onPress={abort} style={styles.cancel} hitSlop={12}>
          <Text style={styles.cancelText}>CANCEL</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPressIn={startHold}
      onPressOut={cancelHold}
      disabled={disabled}
      style={[
        styles.btn,
        {
          borderColor: tint,
          backgroundColor: medical ? 'rgba(255,176,32,0.10)' : 'rgba(255,77,141,0.10)',
          opacity: disabled ? 0.4 : 1,
          borderRadius: medical ? 18 : 999,
        },
      ]}
    >
      <Animated.View
        style={[styles.fill, { width, backgroundColor: tint, opacity: 0.28 }]}
        pointerEvents="none"
      />
      {medical && <Text style={[styles.cross, { color: tint }]}>✚</Text>}
      <Text style={[styles.title, { color: tint }]}>{title}</Text>
      <Text style={styles.sub}>{holding ? 'keep holding…' : subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 2,
    paddingVertical: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    minHeight: 148,
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  cross: { fontSize: 30, marginBottom: 2, fontWeight: '900' },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: 1.5 },
  sub: { color: COLORS.textFaint, fontSize: 12, marginTop: 5 },
  countNum: { fontSize: 64, fontWeight: '900', lineHeight: 68 },
  countLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  cancel: {
    marginTop: 10,
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  cancelText: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 1.4 },
});
