# Hum

**Turn any table into a touch surface.** Lay an Android phone flat on a table, teach it your knocks in 30 seconds, and every *kind* of knock — a palm slap or a knuckle knock, once, twice or three times, anywhere on the table — becomes a button, using only the phone's microphone and on-device machine learning. No extra hardware, no camera, and the audio never leaves the phone.

**Live:** https://hum-navy.vercel.app (phone app, Android Chrome) · https://hum-navy.vercel.app/companion.html (laptop companion)

> Work in progress — built during **GENESIZ 2026 AppForge** ("The Impossible App").
> Hum is an **assistive aid, not a medical device**.

## Status

Working: microphone → AudioWorklet → onset detection → spectral features → k-NN classifier (palm vs knuckle) → rhythm layer (1–3 knocks); a ~30-second setup wizard (noise calibration, 8 palm + 8 knuckle knocks, "not a command" sounds, leave-one-out self-check with plain-English fixes); saved table profiles; the **Access Pad** (knock a pattern, Hum asks "…?", one palm says it — in a synthetic or a recorded family voice); **SOS** (fast drumming → countdown → siren + Companion alert); a **Companion** page for a laptop (pair by QR or room code; caregiver feed of every spoken phrase; full-screen SOS alert with acknowledge; **Desk Remote** media player controlled by knocks); a randomised on-device accuracy test. Real accuracy numbers will be published here once measured on a phone.

## How it works (short version)

1. **Capture** raw mic audio with the phone's voice processing (echo cancellation, noise suppression, auto-gain) switched off.
2. **Onset detection** spots the sudden energy jump of a knock against an adaptive noise floor.
3. **Features**: ~45 ms around each knock → log-mel spectrum shape, MFCCs, spectral centroid/roll-off/flatness, attack and decay, plus stereo level/time differences when the phone really exposes two mics.
4. **k-nearest-neighbours** compares each knock with the examples you taught it (palm or knuckle); low-confidence knocks are "not sure".
5. **Rhythm layer** groups knocks less than 450 ms apart into a pattern: the type is a vote across the pattern, the count is the number of knocks. 6+ fast knocks = SOS.

> Why not "every spot on the table"? The first prototype tried to learn tap *locations* around the phone; on a real table, with one microphone lying on it, left/right/near/far sounded too alike. *How* you knock (palm vs knuckle) is very distinct, so Hum uses tap type × number of knocks instead.

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
