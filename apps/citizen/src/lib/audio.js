// expo-av compatibility layer on top of expo-audio.
//
// expo-av was removed from Expo Go after SDK 54, so on SDK 58 importing it
// crashes the app. This module exposes the small slice of expo-av's `Audio`
// API the app uses (Recording, Sound, permissions, audio mode) implemented
// with expo-audio, so call sites keep working unchanged.

import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync as setExpoAudioModeAsync,
} from 'expo-audio';
import { createRecordingOptions } from 'expo-audio/build/utils/options';

class Recording {
  constructor() {
    this._recorder = null;
    this._interval = 500;
    this._onStatus = null;
    this._poll = null;
  }

  async prepareToRecordAsync(options = RecordingPresets.HIGH_QUALITY) {
    this._recorder = new AudioModule.AudioRecorder(createRecordingOptions(options));
    await this._recorder.prepareToRecordAsync();
  }

  setProgressUpdateInterval(ms) {
    this._interval = ms;
  }

  setOnRecordingStatusUpdate(cb) {
    this._onStatus = cb;
  }

  async startAsync() {
    this._recorder.record();
    if (this._onStatus) {
      this._poll = setInterval(() => {
        try {
          const s = this._recorder.getStatus();
          this._onStatus({ isRecording: s.isRecording, metering: s.metering });
        } catch {
          /* recorder released */
        }
      }, this._interval);
    }
  }

  async stopAndUnloadAsync() {
    if (this._poll) clearInterval(this._poll);
    this._poll = null;
    if (this._recorder) await this._recorder.stop();
  }

  getURI() {
    return this._recorder?.uri ?? null;
  }
}

const Sound = {
  async createAsync(source) {
    const player = createAudioPlayer(source);
    const sound = {
      async playAsync() {
        player.play();
      },
      async unloadAsync() {
        player.remove();
      },
    };
    // Free the native player once playback finishes.
    player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) player.remove();
    });
    return { sound };
  },
};

async function setAudioModeAsync(mode = {}) {
  await setExpoAudioModeAsync({
    allowsRecording: !!mode.allowsRecordingIOS,
    playsInSilentMode: mode.playsInSilentModeIOS ?? true,
    shouldPlayInBackground: !!mode.staysActiveInBackground,
    ...(mode.staysActiveInBackground ? { allowsBackgroundRecording: true } : {}),
  });
}

export const Audio = {
  requestPermissionsAsync: requestRecordingPermissionsAsync,
  setAudioModeAsync,
  Recording,
  Sound,
  RecordingOptionsPresets: RecordingPresets,
};
