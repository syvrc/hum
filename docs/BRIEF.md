# HUM — Build Brief for Claude
### GENESIZ 2026 AppForge · Theme: "The Impossible App"

You are my senior engineer and co-founder for a **1–3 day solo hackathon build**. I'm new to coding (I know basic git: create a repo, commit, discard changes, revert to an old commit). You will write almost all of the code; I will run it on my phone, test it, and film the demo. Work autonomously, keep me moving, and never let a day end without a working, deployed build. Think carefully before writing the audio pipeline and the gesture layer — that's where the bugs will hide and where the judges' "how?!" comes from.

---

## 0. First actions (do these before anything else)

1. Save this entire brief verbatim to `docs/BRIEF.md`. Then create a short `CLAUDE.md` at the repo root (≤60 lines) containing: the one-line pitch, the non-negotiable rules from §9, a **"Current phase:"** line, the commands to run / test / deploy, and "Full spec: docs/BRIEF.md". Keep the current-phase line updated as we go — I'll be working across multiple sessions and a fresh session must be able to pick up exactly where we left off.
2. Check my machine: `node -v` (need Node 20+ LTS) and `git --version`. If either is missing, give me the exact Windows install step (e.g. `winget install OpenJS.NodeJS.LTS`, `winget install Git.Git`) and wait for me.
3. Reply with (a) the plan in ≤10 bullets, (b) genuine blockers or questions only (max 3), then (c) start Phase 0 immediately — don't wait for approval unless something is actually blocking.

---

## 1. The competition (what we are optimizing for)

- **Brief:** build a mobile app that does something unexpected, highly innovative, or seemingly impossible with phone hardware (sensors, mic, camera, on-device ML, AR…).
- **Judging weights:** Originality & Innovation **35%** · Clever Use of Tech **30%** · The Experience **20%** · Functional Execution **15%**.
- **Rules that shape the build:**
  - Mobile-first (progressive mobile web is allowed — that's our route).
  - The core concept must work **live**. Mockups are rejected.
  - Meaningful interaction and a clear reason to exist.
  - Must be created during the event: fresh repo, no pre-existing app code (libraries are fine).
  - I must be able to explain the solution and implementation choices to judges.
  - No faked or manipulated evidence.
- **Deliverables:** (1) public source repo, (2) hosted mobile-web link as the working prototype, (3) demo video ≤ 2 minutes showing the "impossible" feature actually working, (4) README covering the problem, the technology, and the interaction model.
- **My constraints:** solo · 1–3 days · Windows laptop running **Claude Code Desktop** · **Android phones only** for testing (Chrome) · I have two phones and a laptop for the demo.
- **Strategy:** one jaw-drop capability that works 9 times out of 10 beats many half-working features. Riskiest thing first. Ship something deployable at the end of every phase.

---

## 2. The product: **Hum**

**One-liner:** Hum turns any table into a touch surface. Lay an Android phone flat on a table, teach it your knocks in 30 seconds, and every spot and kind of tap on the table becomes a button — using only the phone's microphone and on-device machine learning. No extra hardware, no camera, and the audio never leaves the phone.

**Hero use case — "Access Pad":** People with tremors (e.g. Parkinson's), cerebral palsy, stroke recovery, severe arthritis, or low vision often can't reliably hit small targets on a glass touchscreen. A table is a huge, forgiving target: slap the left side with a palm, knock the right side with a fist. Hum turns those big, imprecise movements into spoken phrases ("I need water", "Yes", "No", "I'm in pain") and an SOS. Because Hum is trained on *that person's own* taps, the 30-second teaching step isn't a limitation — it's the feature: it adapts to how they actually move. Dedicated communication aids and accessibility switches are specialist, often expensive hardware; Hum needs a phone and any table.

**Positioning:** an assistive aid, **not a medical device**. Say so in the app and the README.

**Bonus mode — "Desk Remote":** the same knocks control a music/video player page on a laptop (play/pause, next, previous, volume).

**Companion page:** runs on a laptop or a second phone. Shows the caregiver feed (every phrase Hum speaks, timestamped), receives SOS alerts, and hosts the Desk Remote media player.

---

## 3. Interaction model

### 3.1 Setup — "Teach Hum your table" (target ≤ 60 s)
1. Place the phone face-up on the table (tip: on the printed pad mat or inside a tape outline so it doesn't move). Grant mic permission.
2. **Silence calibration:** 3 s of quiet to measure the noise floor.
3. **Pad training:** for each pad, the screen shows where and how to tap ("LEFT side · PALM") on a top-down table diagram. The user taps it ~6–8 times; each accepted tap fires a ripple and a counter.
4. **"Not a command" class (optional but recommended):** 5 s of talking, clapping, setting a cup down — so Hum learns what to ignore.
5. **Self-check:** Hum runs leave-one-out cross-validation and shows a confusion matrix plus a per-pad separability score. If two pads get confused, it says so in plain words ("LEFT-PALM and NEAR-PALM sound alike — merge them, move one, or change the tap type") with one-tap fixes.
6. Save as a named **Surface Profile** (e.g. "Dining table"). Profiles persist offline.

### 3.2 Input vocabulary — built in tiers
Never start a tier until the previous one works on my phone.

- **Tier 1 (must ship):** *location zones* around the phone (left / right / near / far — how many depends on the Phase 0 data) × *tap type* (palm slap, knuckle knock, fingernail tap, fist). Each pad = one trained (zone, type) class. Default 4–6 pads, max 8.
- **Tier 2 (cheap, high value):** a *gesture layer* on top of the tap stream — single, double (same pad, ≤ 350 ms gap, tunable), triple, and the **SOS pattern** (default: ≥ 6 taps anywhere within 3 s, location-agnostic, configurable). Single-tap actions should only wait for the double-tap window when that pad actually has a double-tap binding. SOS must never be pre-empted by earlier taps in the same burst (it's fine if the first taps briefly preview a phrase — SOS overrides). Also: **phone-moved detection** via the accelerometer → prompt a quick "one tap per pad" recalibration.
- **Tier 3 (stretch):** *scratch / swipe* — dragging a nail across the table. Detect it as sustained broadband noise (high spectral flatness, > 200 ms) versus impulsive taps; estimate direction from the amplitude trend (getting louder = moving toward the phone). Use it as a slider (volume in Desk Remote).

### 3.3 Access Pad (hero mode)
- Each pad maps to a phrase. Editable defaults: "Yes", "No", "I need water", "I'm in pain", "Please come here", "Thank you".
- **Confirm mode** (default ON, toggle in settings): a tap *previews* the phrase (big tile highlights + soft chime + short vibration); a double-knock confirms and speaks it (decide from the data whether "double-knock on the same pad" or "double-knock anywhere" is more robust); the preview cancels after 4 s. Confirm OFF = speak immediately.
- **Voice:** English text-to-speech (Web Speech API, adjustable rate) **and** per-phrase recorded voice clips (a caregiver/family member records them via MediaRecorder; a clip is preferred, TTS is the fallback).
- Every spoken phrase is sent to the Companion caregiver feed when connected.
- **SOS:** pattern detected → 3-second countdown (loud beeps + big CANCEL; touching the screen cancels) → phone siren (Web Audio) + full-screen red/black flashing at **≤ 2 flashes per second** (stay under the WCAG three-flashes-per-second limit) + vibration + an SOS message to the Companion. The phone-side SOS works offline; the Companion alert needs a connection.
- **Live screen:** giant high-contrast phrase tiles laid out spatially to match the table (the left pad's tile is on the left). Readable at arm's length.

### 3.4 Desk Remote (bonus mode)
- Phone in "Remote" mode maps pads/rhythms to: play/pause, next, previous, volume up/down (scratch → volume slide in Tier 3).
- Companion "Media" view: drag-and-drop local audio/video files into a playlist, HTML5 player, a big now-playing display, and a flash animation for each incoming command so the video clearly shows *knock → effect*. YouTube via the IFrame API is a stretch goal only.

### 3.5 Companion page
- Shows a short room code + a QR code. The Hum phone joins by scanning (the QR opens Hum with `?room=CODE`) or by typing the code.
- **Caregiver view:** timestamped phrase feed; **SOS takeover** — full-screen alarm, siren, a system Notification if the tab is in the background, and an "Acknowledge" button that sends an ack back so the phone shows "Help is coming".
- **Media view:** as above.
- Browser autoplay rules: show a "Click to arm sound" overlay on load. Nothing may depend on audio that hasn't been unlocked by a user gesture (same on the phone: resume the AudioContext on the first tap).

---

## 4. Technical architecture

### 4.1 Stack — boring and explainable
- **Vite + vanilla JavaScript** (ES modules). No framework, no TypeScript.
- **Multi-page build:** `index.html` (phone app) and `companion.html` (laptop/second phone) — avoids SPA-routing problems on static hosting.
- **Small, justified dependencies only:** `meyda` (audio features) or a tiny FFT lib, `peerjs` (WebRTC data channel via the free public PeerJS server), `qrcode`, `idb-keyval` (IndexedDB), `vite-plugin-pwa`, `@vitejs/plugin-basic-ssl` (dev only), fonts via `@fontsource/*` (bundled so it works offline). Ask me before adding anything else.
- **Hosting:** GitHub repo → Vercel (auto-deploy on push, HTTPS). Walk me through the one-time Vercel import.
- **PWA:** installable; the phone app's core (training, Access Pad, SOS) works offline. Networked features degrade gracefully.

### 4.2 Audio pipeline (the heart — get this right)
1. **Capture:** `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } } })`. Log `track.getSettings()` to the debug panel (actual sample rate, channel count, whether processing is really off). Handle both 44.1 kHz and 48 kHz.
2. **AudioWorklet** streams raw Float32 frames into a ring buffer (load the worklet with a Vite-friendly URL such as `new URL('./worklet.js', import.meta.url)`). No ScriptProcessorNode.
3. **Onset detection:** adaptive noise floor (slow-moving RMS) vs. short-term energy; trigger when energy > k × floor *and* above an absolute minimum; refractory period ~100 ms (tunable). Cut a fixed window around the onset: ~5 ms before + ~45 ms after (power-of-two length for the FFT).
4. **Features per tap** (main thread, or a Web Worker if the UI janks): log-mel band energies (~32 bands), 13 MFCCs averaged over 2–3 sub-frames, spectral centroid / rolloff / flatness, zero-crossing rate, attack time, envelope decay slope, peak level.
   - If stereo is *really* available: per-band inter-channel level difference + GCC-PHAT time delay between the two mics (a strong location signal — the same idea research systems like UbiK used with a phone's two mics).
   - Optionally fuse the accelerometer `devicemotion` spike (x/y direction) closest to the onset. **Measure** whether it helps before keeping it.
5. **Normalization:** z-score with training-set statistics; don't let raw loudness dominate (keep it as one low-weight feature).
6. **Classifier:** k-NN (k = 3–5, distance-weighted) — explainable, trains instantly, works with 6–8 samples per class. Confidence = vote margin; below threshold → "not sure" (no action). Use the "Not a command" class when trained. Only upgrade to logistic regression or a tiny MLP if the Phase 0 data shows k-NN isn't enough — and justify it to me.
7. **Online learning (Tier 2):** confirmed, high-confidence taps are added to the profile (capped per class, oldest dropped), so Hum improves with use.
8. **Self-hearing guard:** suspend detection while Hum is speaking, playing a clip, beeping, sounding the siren, or vibrating (+150 ms tail). Android's `speechSynthesis.onend` can be unreliable — back it up with an estimated duration + safety timeout.
9. **Latency target:** knock → action ≤ 150 ms. Measure it and show it in the debug HUD.

### 4.3 Other platform details
- **Screen Wake Lock** so the screen stays on (web apps can't listen with the screen off — say so in README limitations); re-acquire it on `visibilitychange`.
- `navigator.vibrate` for haptic confirmation.
- **Storage (IndexedDB):** profiles (feature vectors, labels, normalization stats, pad config, phrases), voice-clip Blobs, settings. Export/import a profile as JSON.
- **Link protocol** (JSON over the PeerJS data channel): `{ v: 1, type: 'hello' | 'phrase' | 'sos' | 'sos_cancel' | 'ack' | 'media', ts, ... }`; auto-reconnect; a connection-status pill on both ends. README note: if venue Wi-Fi blocks WebRTC, use a phone hotspot.
- **Never send audio anywhere.** All processing on-device.

### 4.4 Dev/test loop on Windows + Android (set this up in Phase 0)
- Mic access needs HTTPS or localhost. **Preferred loop:** phone on USB with USB debugging enabled → Chrome on the laptop → `chrome://inspect` → Port forwarding `5173 → localhost:5173` → the phone opens `http://localhost:5173` (a secure context, and I can see the phone's console on the laptop). **Fallback:** `vite --host` with basic-ssl over Wi-Fi (accept the cert warning; allow Windows Firewall). Vercel deploys for sharing. Give me step-by-step instructions the first time only.
- **In-app debug panel** (hidden behind a long-press on the logo): live log console, the `getSettings()` dump, noise floor, last tap's features + prediction + confidence + latency, and a **"Copy debug report"** button producing JSON I can paste back to you.
- **Optional "Record taps" mode** that saves labelled raw tap windows as WAV for download, plus `tools/analyze.py` you can run on them to tune features/thresholds offline. Use this if live tuning stalls.
- You can't hear my table. Whenever on-device testing is needed, give me an exact numbered test script: what to tap, how many times, what to read off the screen, and what to paste back to you.

---

## 5. Design direction: "lab instrument" + accessible live mode

- **Feel:** a precision acoustic instrument. Near-black background, phosphor-green/cyan signal colour, amber for warnings, red reserved for SOS. Monospace for readouts (e.g. JetBrains Mono or IBM Plex Mono), a clean grotesk for UI text. Thin grid lines and tick marks; subtle grain only if it doesn't hurt legibility.
- **Signature visuals:** live oscilloscope waveform; scrolling spectrogram strip; a top-down **table map** with the phone in the centre, where every detected tap fires a ripple at the predicted pad with a confidence arc; a confusion-matrix heatmap after training; an event-log console.
- **Access Pad live mode overrides the lab look where it matters:** huge tiles, ≥ 28 px text, WCAG AA contrast, no tiny tap targets, nothing essential conveyed by colour alone.
- Mobile-first portrait, usable one-handed; a clean wide layout for the Companion on a laptop.
- **Brand:** the name is **Hum**. Propose 3 taglines and a simple SVG wordmark/logo + PWA icons. Hum plays a soft hum/chime when it hears a valid tap.
- **Extra (Tier 2/3):** a printable A4 **pad mat** page (CSS print layout) with the phone outline and labelled zones — makes setup repeatable and looks great on camera.

---

## 6. Build plan (phases = commits; each ends deployed and demoable)

Time-box everything. If a phase overruns, cut scope, not quality. At the end of each phase: commit with a clear message, push, confirm the Vercel deploy, update CLAUDE.md's current-phase line, and tell me exactly what to test.

- **Phase 0 — Spike & go/no-go (~2–3 h, FIRST).** Scaffold the Vite multi-page project + git; mic capture + worklet + onset detection + live waveform; features + k-NN; a bare training screen for 4 pads (e.g. left-palm, right-palm, near-knuckle, far-knuckle) and a test screen. Then give me the on-device accuracy test (20 prompted taps per pad, randomized).
  **Gate:** ≥ 85% → continue as planned. 70–85% → merge/reduce zones, lean on tap type, try stereo/accelerometer features. < 70% on location → **Plan B:** tap TYPE (palm/knuckle/nail/fist) × RHYTHM (single/double/triple) carries the vocabulary (12 commands with no location needed) — the product story stays the same. Report the real numbers to me either way.
- **Phase 1 — Real training flow + profiles.** Setup wizard, noise calibration, "Not a command" class, LOO cross-validation + confusion matrix + plain-English advice, IndexedDB profiles, debug panel.
- **Phase 2 — Access Pad.** Phrase mapping, confirm mode, TTS, voice-clip recording, live tile UI, self-hearing guard, wake lock, haptics.
  → **End-of-Day-1 target:** Phases 0–2 working on my phone and deployed. That alone is a valid submission.
- **Phase 3 — Gesture layer + SOS.** Double/triple detection, SOS pattern + countdown + siren + flashing, phone-moved detection + quick recalibration, online learning.
- **Phase 4 — Companion.** PeerJS room + QR, caregiver feed, SOS takeover + Notification + ack, media view + Desk Remote mode on the phone.
- **Phase 5 — Polish.** Lab-instrument visuals (spectrogram, ripples, table map), PWA install/offline, onboarding copy, empty/error states (mic denied, no connection, too noisy), printable pad mat.
- **Phase 6 — Stretch (only if everything above is solid).** Scratch/swipe slider, YouTube in the media view, stereo/accelerometer fusion if not already done.
- **Phase 7 — Ship kit (reserve the last ~4 h no matter what).** README, demo script, cheat sheet, final accuracy measurement, final deploy, repo tidy.

---

## 7. Ship kit — write these files

### `README.md` (the judges read this)
- Title, tagline, live link, placeholders for a GIF/screenshots.
- The problem → what Hum does.
- How it works: a Mermaid pipeline diagram (mic → onset detection → features → k-NN → gesture layer → action / link).
- Technology used: each browser API and library, and *why* it was chosen.
- Interaction model: setup, pads, tap types, rhythms, confirm mode, SOS, Desk Remote, Companion.
- **Measured accuracy** from my real test (number of pads, taps, % correct, latency).
- Try it in 60 seconds.
- Honest limitations: screen must stay on, noisy rooms, the phone must not move, tablecloths/soft surfaces kill it, Android Chrome first, not a medical device.
- Privacy: audio never leaves the phone.
- Prior research credit (e.g. Microsoft Research UbiTap, UbiK, KAIST surface-sound touch work — **verify each citation before including it**) and what we did differently: no extra hardware, trains in 30 s in a browser, a personal per-user model, an accessibility focus.
- "Built during GENESIZ 2026 AppForge."

### `docs/DEMO_SCRIPT.md` (≤ 2:00)
Shot list for my setup: **Phone A** films top-down over the table, **Phone B** runs Hum lying flat, the **laptop** runs the Companion in frame. Suggested beats:
- 0:00 Hook — knock → "I need water"; hands never touch the screen.
- 0:10 The problem.
- 0:25 30-second training + confusion matrix + accuracy number.
- 0:50 Access Pad live — palm vs knuckle, confirm double-knock, a recorded family-voice clip, caregiver feed appearing on the laptop.
- 1:15 SOS → countdown → phone siren + laptop takeover → acknowledge.
- 1:30 Desk Remote — knock to play/skip music on the laptop.
- 1:45 How it works in one diagram + "all on-device, no extra hardware."
- 1:55 Name + link.
Include narration lines, on-screen captions, and "proof" shots (the screen is never touched; the camera is never used). Add a backup plan in case live judging is in a noisy room.

### `docs/CHEATSHEET.md`
I chose "cheat sheet only", so **don't lecture me during the build** — put the teaching here:
- My 30-second pitch.
- The architecture in plain English, with an everyday analogy for each part (onset detection, FFT/features, k-NN, cross-validation, WebRTC).
- A "what each file does" table.
- Every library and why we used it.
- The 15 most likely judge questions with short, honest answers — e.g. "Isn't this just a tap detector?", "How accurate is it?", "Why not just use the touchscreen?", "Why k-NN and not deep learning?", "Does it work in noise?", "What did AI write vs. you?", "What about privacy?", "How is this different from the UbiTap research?"
- Known limitations and what I'd build next (native app for background listening, multi-mic time-difference localization, smartwatch alerts).

Comment the code at the "why" level so I can walk judges through the key files.

---

## 8. Definition of done

- [ ] Hosted HTTPS link opens on a fresh Android phone, installs as a PWA, and the core works offline.
- [ ] Training ≤ 60 s; real measured accuracy reported; confusion matrix shown.
- [ ] Access Pad: ≥ 4 pads → phrases, confirm mode, TTS + recorded clips, no self-triggering from its own audio.
- [ ] SOS: pattern → countdown → siren/flash on the phone → alert + acknowledge on the Companion.
- [ ] Desk Remote controls the laptop media page.
- [ ] Debug panel + copyable debug report.
- [ ] README, DEMO_SCRIPT, CHEATSHEET written; repo public; final deploy verified on the phone.

---

## 9. Non-negotiable rules for you

1. **Never fake it.** No hard-coded or scripted detections, no "demo mode" that pretends to classify. If something doesn't work, tell me and we cut or pivot. Mockups are disqualifying, and judges may ask to try it themselves.
2. **Riskiest first, always working.** Never leave the main branch broken; small commits; if a change breaks on-device behaviour, revert (`git revert` / `git restore`) instead of piling on fixes.
3. **Minimal dependencies, plain JavaScript, readable code** with "why" comments. Simple and explainable beats clever and opaque.
4. **I'm a beginner on Windows.** When I have to do something myself (install, enable USB debugging, Vercel import, filming), give numbered steps with exact clicks/commands. Otherwise just do the work. Short status updates, no lectures — that's what CHEATSHEET.md is for.
5. **Honest claims only:** "assistive aid, not a medical device"; report real accuracy numbers; credit prior research and libraries.
6. **Privacy:** audio is processed on-device and never uploaded; only user-recorded phrase clips and optional debug recordings are stored, and only locally.
7. **Ask before big changes:** if a decision changes scope, the product story, or adds a big dependency, ask me one short question with your recommendation.
8. **Keep CLAUDE.md current** so a fresh session can continue exactly where we left off.

**Start now with §0.**
