# Hum

**Turn any table into a touch surface.** Lay an Android phone flat on a table, teach it your knocks in 30 seconds, and every spot and kind of tap on the table becomes a button — using only the phone's microphone and on-device machine learning. No extra hardware, no camera, and the audio never leaves the phone.

> Work in progress — built during **GENESIZ 2026 AppForge** ("The Impossible App").
> Hum is an **assistive aid, not a medical device**.

## Status

Working: microphone → AudioWorklet → onset detection → spectral features → k-NN classifier; a ~1-minute setup wizard (noise calibration, per-pad training, "not a command" sounds, leave-one-out self-check with plain-English fixes); saved table profiles; the **Access Pad** (knock to preview a phrase, double-knock to speak it, in a synthetic or a recorded family voice); a randomised on-device accuracy test. Real accuracy numbers will be published here once measured on a phone.

## How it works (short version)

1. **Capture** raw mic audio with the phone's voice processing (echo cancellation, noise suppression, auto-gain) switched off.
2. **Onset detection** spots the sudden energy jump of a knock against an adaptive noise floor.
3. **Features**: ~45 ms around each knock → log-mel spectrum shape, MFCCs, spectral centroid/roll-off/flatness, attack and decay, plus stereo level/time differences when the phone really exposes two mics.
4. **k-nearest-neighbours** compares the knock with the examples you taught it; low-confidence knocks are rejected as "not sure".

## Run it locally

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173 (phone via USB + chrome://inspect port forwarding)
npm test           # unit tests for the DSP + classifier on synthetic taps
npm run build      # production build in dist/
```

## Privacy

All audio processing happens in the browser on the phone. Nothing is uploaded. Training taps are stored locally (IndexedDB) and only leave the phone if you explicitly export them.

## License

MIT
