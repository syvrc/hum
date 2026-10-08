# Hum — Cheat Sheet

Your study guide for judging. Everything here is true of the code in this repo.
Numbers marked **[after phone test]** must be filled in from your real measurements — never guess them.

---

## 1. The 30-second pitch

> "Hum turns any table into a touch surface. You lay an ordinary Android phone flat on the table, teach it your knocks in about a minute, and every spot and kind of tap on the table becomes a button — using only the phone's microphone and on-device machine learning. No extra hardware, no camera, and the audio never leaves the phone.
>
> Why? People with tremors, cerebral palsy, stroke recovery or severe arthritis often can't hit small targets on a glass screen. A table is a huge, forgiving target. Slap the left side, Hum says 'Yes'. Knock the right side, Hum says 'I need water' — in a family member's recorded voice if you like — and a caregiver's laptop shows it instantly. Because Hum learns *your* taps, the one-minute teaching step isn't a limitation, it's the feature: it adapts to how you actually move."

Then show it: knock → phrase, hands never touching the screen.

---

## 2. How it works, in plain English

The pipeline: **microphone → AudioWorklet → ring buffer → onset detector → features → k-NN → gesture layer → speech / Companion link**

| Part | What it does | Everyday analogy |
|---|---|---|
| **Raw microphone** | We ask Chrome to switch OFF echo cancellation, noise suppression and auto-gain. Those "clean-ups" are designed for voice calls and would smear exactly the sharp knock sounds we need. | Taking off noise-cancelling headphones so you can hear the real room. |
| **AudioWorklet** (`worklet.js`) | Runs on the browser's real-time audio thread. It only collects raw samples into 512-sample chunks (~11 ms) and hands them over. No analysis there, so audio never glitches. | A conveyor belt that just keeps moving boxes; the sorting happens elsewhere. |
| **Ring buffer** (`ring.js`) | Keeps the last ~2.7 s of raw audio. When a knock is detected we can still cut out the 5 ms *before* it. | A dashcam that's always recording the last few seconds. |
| **Onset detector** (`onset.js`) | Slices sound into 1.3 ms pieces and tracks the room's noise floor. A knock = a slice ≥ 12 dB above the floor, ≥ 6 dB louder than the moment just before (a *jump*, not just "loud"), and above an absolute minimum. Then it ignores 100 ms so one knock's ringing can't fire twice. | A bouncer who ignores the steady murmur of a party but notices a door slam. |
| **Features** (`features.js`) | Turns ~43 ms of sound around the knock into 65 numbers: the spectrum's shape (32 mel bands), 13 MFCCs, brightness (spectral centroid), roll-off, noisiness (flatness), zero-crossings, attack time, decay speed, loudness (low weight), and — only if the phone really has two separate mics — the level and timing difference between them. | A fingerprint: palm = dull and slow; knuckle = bright and sharp; far away = high frequencies faded on the way through the wood. |
| **FFT** (`dsp.js`) | Splits a slice of sound into "how much of each frequency". Written by hand (~40 lines) so we can explain it. | A prism splitting white light into colours, or the bars on a music equaliser. |
| **Mel bands / MFCCs** | Group frequencies the way the ear does (fine at low pitches, coarse at high), then summarise the shape of that curve in 13 numbers. | Describing a mountain range by its overall silhouette instead of every rock. |
| **z-score normalisation** | Converts every feature to "how unusual is this compared with the training taps", so Hz and dB are comparable. | Converting cm and kg into "how many standard sizes above average". |
| **k-NN classifier** (`knn.js`) | Finds the 3 training knocks most similar to the new one; they vote, closer ones count more. Confidence = how clear the vote was. If the knock is unlike *everything* taught (distance ratio too big) or the vote is too close, Hum says "not sure" and does nothing. | Recognising a friend by their knock on your door, because it sounds like their previous knocks. |
| **"Not a command" class** | During setup you make 5 s of everyday noise (talking, clapping, a cup). Those become a class Hum learns to *ignore*. | Teaching a dog which sounds are the doorbell and which are the TV. |
| **Leave-one-out cross-validation** | The self-check: for each training tap, train on all the *others* and test on that one. An honest accuracy estimate without extra test taps. | Quizzing yourself with one flashcard hidden at a time. |
| **Confusion matrix** | Rows = what you tapped, columns = what Hum heard. The diagonal is "right"; off-diagonal cells show which pads get mixed up. The wizard turns that into plain-English advice with one-tap fixes. | A teacher's mark sheet that shows not just *how many* answers were wrong but *which* wrong answer was picked. |
| **Gesture layer** (`gesture.js`) | Confirm mode: one knock previews a phrase; a double-knock (≤ 350 ms apart) anywhere speaks it; preview expires after 4 s. A double-knock from idle only previews, so a tremor "bounce" can't speak by accident. | "Are you sure?" — but answered with a knock. |
| **Self-hearing guard** (`voice.js`) | The phone lies *on* the table, so its own speaker and vibration shake the table like a knock. Every sound Hum makes switches detection off for its duration + 150 ms. Android's "speech finished" event is unreliable, so an estimated duration is the backstop. | Covering your own ears while you talk so you don't mistake your voice for someone knocking. |
| **Speech + recorded voices** | Web Speech API for text-to-speech; MediaRecorder for a family member's recorded clips (preferred over the synthetic voice). Stored only on the phone. | — |
| **Surface Profiles** (`profile.js`, `store.js`) | Each table is saved in IndexedDB with the *raw* example knocks, so improved feature code automatically upgrades old profiles. Export/import as JSON. | Saving a game — including the replays, not just the score. |
| **WebRTC via PeerJS** (`link.js`) | The phone and the Companion page find each other through the free PeerJS server using a 5-letter room code (or QR), then talk directly. Only tiny text messages travel (phrases, SOS, media commands) — never audio. Auto-reconnects with a heartbeat. | A switchboard operator who connects the call and then leaves the line. |

---

## 3. What each file does

| File | Role |
|---|---|
| `index.html`, `src/main.js` | Phone app shell; boots the mic, wires screens, debug panel (long-press the logo). |
| `src/app.js` | Shared state: engine, active table profile + model, settings, navigation, tap routing, self-hearing guard hookup. |
| `src/audio/worklet.js` | Real-time audio thread: raw samples → 512-sample chunks. |
| `src/audio/engine.js` | Mic + AudioContext + worklet; ring buffer; onset detection; emits a tap window per knock; mute intervals. |
| `src/audio/ring.js` | Ring buffer (last ~2.7 s). |
| `src/audio/onset.js` | Adaptive noise floor + sudden-rise detector. |
| `src/audio/dsp.js` | FFT, windows, mel filterbank, DCT (hand-written). |
| `src/audio/features.js` | 65-number fingerprint per knock, in 7 weighted groups; honest stereo check; GCC-PHAT delay. |
| `src/ml/knn.js` | z-score k-NN with confidence + "sounds like nothing I know"; leave-one-out; confusion matrix. |
| `src/profile.js` | Table profiles: train, decide (pad / ignored / unsure), self-check, separability, advice + fixes, export/import, default phrases. |
| `src/gesture.js` | Confirm-mode logic (preview, double-knock, timeouts). |
| `src/voice.js` | Speech, recorded clips, chime, vibration — all guarded. |
| `src/link.js`, `src/phoneLink.js` | PeerJS link protocol (both ends) and the phone's side of it. |
| `src/screens/wizard.js` | Setup: place → quiet → pads → ignore sounds → self-check → save. Times itself. |
| `src/screens/access.js` | Access Pad live mode (big spatial tiles). |
| `src/screens/phrases.js` | Phrase editor, voice recording, confirm/voice/speed settings. |
| `src/screens/lab.js` | Randomised accuracy test + live play; report and dataset export. |
| `src/screens/remote.js` | Desk Remote (knocks → media commands). |
| `src/screens/home.js` | Tables list, Companion pairing. |
| `companion.html`, `src/companion.js` | Laptop page: QR/room code, caregiver feed, SOS takeover + siren + acknowledge, media player. |
| `src/ui/*` | Scope, table map, confusion matrix, debug panel, logger. |
| `test/*.test.js` | Node unit tests on synthetic taps (DSP, onsets, features, k-NN, profiles, gestures, full pipeline). |
| `tools/analyze.js` | Offline analysis of exported datasets with the same code as the app (ablation per feature group, k sweep, WAV export). |

---

## 4. Libraries and why

| Library | Why |
|---|---|
| **Vite** | Fast dev server + simple multi-page build (phone app + companion). No framework needed. |
| **peerjs** | WebRTC data channel with a free public signalling server — phone ↔ laptop with no backend of our own. |
| **qrcode** | Draws the pairing QR on the Companion page. |
| **idb-keyval** | Tiny IndexedDB wrapper for profiles, voice clips and settings (stores typed arrays and Blobs directly). |
| **@fontsource/ibm-plex-sans / -mono** | Fonts bundled into the app so it works offline. |
| **@vitejs/plugin-basic-ssl** (dev only) | HTTPS for testing over Wi-Fi (the mic requires a secure page). |

Deliberately **not** used: no audio-feature library (we wrote the FFT/mel/MFCC ourselves so every step is explainable), no ML framework (k-NN is ~150 lines), no UI framework.

---

## 5. Likely judge questions — short, honest answers

1. **"Isn't this just a tap detector?"** — Detecting *that* a tap happened is the easy 10%. Hum tells *which spot* and *which kind* of tap it was, from one microphone that's lying on the table, by learning how this particular table filters each knock. Each pad is a separate learned sound class, plus a learned "ignore" class.

2. **"How accurate is it?"** — On my phone and my table: **[after phone test: X% over N prompted taps on P pads, randomised, latency avg Y ms]**. The app measures this itself with a randomised prompted test and shows the confusion matrix. Accuracy depends on the table, the distance between pads and how consistently you tap.

3. **"Why not just use the touchscreen?"** — For many people with tremor, CP or arthritis, a 1 cm button on glass is the problem. A table is metres wide; a palm slap anywhere on the left half counts. Also: hands-free for the screen means it can sit out of reach, face-up as a big display.

4. **"Why k-NN and not deep learning?"** — We have ~8 examples per pad, collected in a minute. Neural networks need far more data and would overfit; k-NN works with tiny datasets, "trains" instantly, runs on any phone, and is explainable: "this knock sounded most like these three knocks you taught me".

5. **"Does it work in noise?"** — Moderately. The detector needs a sudden jump above the room's measured noise floor, the "not a command" class learns everyday sounds to ignore, and unsure knocks do nothing. Loud continuous noise (music right next to it) or a noisy venue reduces sensitivity. Our demo backup plan covers this.

6. **"What did AI write versus you?"** — Honest answer: I designed the product, the interaction model and the build plan; an AI coding assistant (Claude) wrote most of the code to that spec; I tested everything on my phone, made the go/no-go decisions from the measured data, and I can explain every part — that's what this sheet is for.

7. **"What about privacy?"** — All audio processing happens in the browser on the phone. No audio is uploaded, ever. Training knocks and voice clips are stored only on the phone. The Companion link carries short text messages only.

8. **"How is this different from UbiTap / UbiK research?"** — Those are impressive research systems (see §7). Hum's differences: it runs in a web browser with nothing to install, trains in about a minute with a guided self-check, learns a *personal* model of how *you* tap (including tap *type*, not just location), and is built around an accessibility use case end-to-end: phrases, recorded family voices, confirm mode, caregiver feed and SOS.

9. **"Why does it need training at all?"** — Every table sounds different (wood, glass, size, legs, what's on it) and every person taps differently. Training is how Hum adapts to *your* table and *your* movement — the core of the accessibility idea.

10. **"What if the phone moves?"** — Location cues change if the phone moves. Tape marks or the printed pad mat put it back in the same place; a quick retrain takes about a minute. [Phase 3 adds automatic phone-moved detection via the accelerometer — update this answer if shipped.]

11. **"Does it work with the screen off / in the background?"** — No. Web apps can't listen with the screen off, so Hum keeps the screen awake (Wake Lock API). A native app could listen in the background — next step.

12. **"Can it trigger by accident?"** — Several guards: confirm mode (choose, then double-knock), a double-knock from idle can't speak, "not sure" knocks do nothing, a learned ignore class, and Hum can't hear its own speech or vibration.

13. **"How fast is it?"** — It waits about 40 ms after the knock to capture the sound, then features + classification take a few ms. Measured knock-to-screen latency on my phone: **[after phone test]**. (Target ≤ 150 ms.)

14. **"Is it a medical device?"** — No. It's an assistive aid. It doesn't diagnose or treat anything, and the SOS is a convenience, not an emergency service.

15. **"What's novel here, technically?"** — Doing personalised acoustic surface sensing *entirely in a browser*, in real time, with one or two built-in mics, a one-minute guided training with an honest self-check (leave-one-out + confusion matrix + plain-English fixes), and a self-hearing guard so the device can speak through the very surface it's listening to.

---

## 6. Known limitations, and what we'd build next

**Limitations (be upfront):** screen must stay on; tablecloths and soft surfaces absorb the knock; the phone must not move after training; very noisy rooms reduce sensitivity; Android Chrome first (other browsers untested); the Companion needs internet for pairing (WebRTC; if venue Wi-Fi blocks it, use a phone hotspot); not a medical device.

**Next:** a native app for background listening; multi-microphone time-difference localisation for finer positions; smartwatch alerts for caregivers; sharing a profile between family members' phones; more phrases via tap *sequences*.

---

## 7. Prior research (verified) and how Hum differs

- **UbiTap** — Kim, Byanjankar, Liu, Shu, Shin. *"UbiTap: Leveraging Acoustic Dispersion for Ubiquitous Touch Interface on Solid Surfaces."* ACM SenSys 2018 (KAIST + Microsoft Research). Uses microphones in commodity devices and the *dispersion* of sound in solids to localise touches, reporting sub-centimetre accuracy with small calibration effort. → [Microsoft Research page](https://www.microsoft.com/en-us/research/?p=498140)
- **UbiK** — Wang, Zhao, Zhang, Peng. *"Ubiquitous Keyboard for Small Mobile Devices: Harnessing Multipath Fading for Fine-Grained Keystroke Localization."* ACM MobiSys 2014. Localises taps on a printed keyboard using the phone's microphones (dual-mic for signal diversity); reports > 95% key localisation accuracy.
- **TapSense** — Harrison, Schwarz, Hudson. *"TapSense: Enhancing Finger Interaction on Touch Surfaces."* ACM UIST 2011. Classifies *which part of the finger* (tip, pad, nail, knuckle) touched a screen from the impact sound, with an attached microphone; ~95% for four input types. → [project page](https://chrisharrison.net/index.php/Research/TapSense)
- **Toffee** — Xiao, Lew, Marsanico, Hariharan, Hudson, Harrison. *"Toffee: Enabling Ad Hoc, Around-Device Interaction with Acoustic Time-of-Arrival Correlation."* MobileHCI 2014. Uses acoustic time differences of arrival to resolve the *bearing* of taps on a hard tabletop around a device (mean error 4.3° with a laptop prototype). → [project page](https://www.robertxiao.ca/research/toffee/)

**What Hum does differently:** no extra hardware and nothing to install (a web page); one-minute guided training with an honest self-check; a personal model that learns *both* where and *how* you tap; and a complete accessibility product around it (spoken phrases, recorded family voices, confirm mode, caregiver feed, SOS, Desk Remote).

---

## 8. Numbers worth remembering

- Knock window: 2048 samples ≈ 43 ms (48 kHz), 5 ms of it before the onset
- Detector slices: 64 samples ≈ 1.3 ms · tap threshold: floor + 12 dB and a 6 dB jump · refractory 100 ms
- Features: 65 numbers in 7 groups · classifier: k = 3, distance-weighted votes
- Setup: 3 s quiet + 8 taps per pad + optional 5 s ignore sounds ≈ 1 minute
- Confirm: double-knock gap ≤ 350 ms, preview lasts 4 s · self-hearing guard tail 150 ms
- Measured on my phone: accuracy **[after phone test]** · latency **[after phone test]** · setup time **[after phone test]**
