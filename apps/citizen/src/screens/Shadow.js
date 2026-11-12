import { useState } from 'react';
import { Pressable, Text, View, StyleSheet, Dimensions } from 'react-native';
import { COLORS } from '../lib/ui';

/**
 * Shadow mode.
 *
 * The app launches as a working calculator. It really calculates — if
 * someone takes the phone and taps at it, it behaves exactly like a
 * calculator, because a disguise that falls apart under one tap is worse
 * than no disguise.
 *
 * Two PINs, entered and confirmed with "=":
 *   NORMAL PIN  opens SafeHer.
 *   DURESS PIN  opens SafeHer *identically* — and silently raises a
 *               safety SOS with silent = true, trigger_reason = 'duress'.
 *
 * Nothing on this screen ever hints that the second PIN exists. No
 * flash, no haptic, no toast. That is the whole point.
 */

const NORMAL_PIN = '1234';
const DURESS_PIN = '9000';

const KEYS = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '=' ],
];

export default function Shadow({ onUnlock, onDuress }) {
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState(null);
  const [op, setOp] = useState(null);
  const [fresh, setFresh] = useState(true);

  function press(k) {
    if (/[0-9]/.test(k)) {
      setDisplay((d) => (fresh || d === '0' ? k : d + k));
      setFresh(false);
      return;
    }

    switch (k) {
      case 'C':
        setDisplay('0');
        setAcc(null);
        setOp(null);
        setFresh(true);
        return;

      case '.':
        if (!display.includes('.')) setDisplay(display + '.');
        setFresh(false);
        return;

      case '±':
        setDisplay((d) => (d.startsWith('-') ? d.slice(1) : '-' + d));
        return;

      case '%':
        setDisplay((d) => String(parseFloat(d) / 100));
        return;

      case '=': {
        // The PIN check lives here and nowhere else. It runs before the
        // arithmetic so a PIN never leaves a result on screen.
        if (display === DURESS_PIN) {
          setDisplay('0');
          setFresh(true);
          onDuress();
          return;
        }
        if (display === NORMAL_PIN) {
          setDisplay('0');
          setFresh(true);
          onUnlock();
          return;
        }

        if (op && acc != null) {
          const b = parseFloat(display);
          const r =
            op === '+' ? acc + b : op === '−' ? acc - b : op === '×' ? acc * b : acc / b;
          setDisplay(String(Number.isFinite(r) ? parseFloat(r.toFixed(10)) : 'Error'));
          setAcc(null);
          setOp(null);
          setFresh(true);
        }
        return;
      }

      default:
        // an operator
        setAcc(parseFloat(display));
        setOp(k);
        setFresh(true);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.displayWrap}>
        <Text style={styles.display} numberOfLines={1} adjustsFontSizeToFit>
          {display}
        </Text>
      </View>

      <View style={styles.pad}>
        {KEYS.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((k) => {
              const isOp = ['÷', '×', '−', '+', '='].includes(k);
              const isFn = ['C', '±', '%'].includes(k);
              const wide = k === '0';
              return (
                <Pressable
                  key={k}
                  onPress={() => press(k)}
                  style={({ pressed }) => [
                    styles.key,
                    wide && styles.keyWide,
                    isOp && styles.keyOp,
                    isFn && styles.keyFn,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text
                    style={[
                      styles.keyText,
                      isOp && { color: '#fff' },
                      isFn && { color: '#111' },
                    ]}
                  >
                    {k}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const { width } = Dimensions.get('window');
const GAP = 12;
const SIZE = (width - GAP * 5) / 4;

const styles = StyleSheet.create({
  // Deliberately NOT the SafeHer palette. A calculator that is aubergine
  // and rose is not a calculator.
  screen: { flex: 1, backgroundColor: '#000', justifyContent: 'flex-end' },
  displayWrap: { paddingHorizontal: 24, paddingBottom: 18 },
  display: { color: '#fff', fontSize: 76, fontWeight: '300', textAlign: 'right' },
  pad: { padding: GAP, paddingBottom: 34, gap: GAP },
  row: { flexDirection: 'row', gap: GAP },
  key: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: { width: SIZE * 2 + GAP, alignItems: 'flex-start', paddingLeft: SIZE * 0.42 },
  keyOp: { backgroundColor: '#FF9F0A' },
  keyFn: { backgroundColor: '#A5A5A5' },
  keyText: { color: '#fff', fontSize: 34, fontWeight: '400' },
});

export { NORMAL_PIN, DURESS_PIN };
