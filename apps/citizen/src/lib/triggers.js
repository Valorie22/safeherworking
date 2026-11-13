import { Accelerometer } from 'expo-sensors';
import { Audio } from './audio';

/**
 * Hands-free triggers.
 *
 * Both of these must be hard to fire by accident — a false SOS costs a
 * real dispatch — and easy to fire when you cannot look at your phone.
 */

/**
 * Shake: three distinct jolts inside 1.5 seconds.
 *
 * "Distinct" matters. Counting raw samples over a threshold would fire
 * on a single hard shake or a bumpy bus. We require the magnitude to
 * fall back below the threshold between jolts, so it takes a deliberate
 * shake-shake-shake.
 */
export function watchShake(onTrigger, { threshold = 1.9, windowMs = 1500, needed = 3 } = {}) {
  let jolts = [];
  let armed = true;

  Accelerometer.setUpdateInterval(80);
  const sub = Accelerometer.addListener(({ x, y, z }) => {
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const now = Date.now();

    if (magnitude > threshold && armed) {
      armed = false;
      jolts.push(now);
      jolts = jolts.filter((t) => now - t <= windowMs);
      if (jolts.length >= needed) {
        jolts = [];
        onTrigger('shake');
      }
    } else if (magnitude < threshold * 0.65) {
      armed = true;
    }
  });

  return () => sub.remove();
}

/**
 * Acoustic: sustained loud audio, not a single bang.
 *
 * A door slam is loud for 200ms. A scream or a struggle is loud for
 * seconds. We require the metering to stay above the threshold across
 * several consecutive readings.
 */
export function watchAcoustic(onTrigger, { thresholdDb = -12, sustainMs = 2500 } = {}) {
  let rec = null;
  let loudSince = null;
  let stopped = false;

  (async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.LOW_QUALITY,
        isMeteringEnabled: true,
      });
      rec.setProgressUpdateInterval(250);
      rec.setOnRecordingStatusUpdate((status) => {
        if (stopped || !status.isRecording || status.metering == null) return;
        if (status.metering > thresholdDb) {
          if (loudSince == null) loudSince = Date.now();
          else if (Date.now() - loudSince >= sustainMs) {
            loudSince = null;
            onTrigger('acoustic');
          }
        } else {
          loudSince = null;
        }
      });
      await rec.startAsync();
    } catch {
      /* acoustic triggering is a bonus, never a requirement */
    }
  })();

  return () => {
    stopped = true;
    rec?.stopAndUnloadAsync?.().catch(() => {});
  };
}
