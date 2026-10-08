# Hum — CLAUDE.md

**Pitch:** Hum turns any table into a touch surface. Lay an Android phone flat, teach it your knocks
in 30 s, and every spot and kind of tap becomes a button — microphone + on-device ML only.
Hero mode "Access Pad" speaks phrases for people who can't reliably hit small touch targets.

Full spec: docs/BRIEF.md (verbatim brief — re-read the relevant section before each phase).

## Status
Current phase: 4 — Companion + Desk Remote. DONE in code. Phases 0, 1, 2, 4 code-complete and browser-verified with
console-injected synthetic audio (38 unit tests). Phase 3 (Tier 2: triple, SOS, phone-moved, online learning) is
DELIBERATELY NOT STARTED: brief says never start a tier until the previous one works on the user's phone.
NOTHING verified on a real phone yet (user away from phone). LIVE: https://hum-navy.vercel.app (auto-deploys from main;
companion at /companion.html — both verified loading, worklet served, PeerJS room claimed).
Next: user's phone session → wizard → Access Pad → accuracy test → "Copy report" → apply the §6 gate (≥85% go /
70–85% reduce / <70% Plan B: tap type × rhythm) → Phase 3 → Phase 5 polish → Phase 7 ship kit.
Decisions: confirm = double-knock ANYWHERE (preview already chose the pad; needs only onset timing). Every output
mutes detection for its duration + 150 ms (voice.js setGuard). Link = PeerJS public server, room code persisted on
both ends, auto-reconnect + heartbeat; SOS messages queue until connected. Desk Remote defaults are spatial.
Testing without a phone: the browser pane has no mic — stub navigator.mediaDevices.getUserMedia from the console
with a MediaStreamDestination playing synthetic taps (test-only, never app code). Link tested with two tabs.

## Commands (Windows, from repo root)
- Install deps: `npm install`
- Dev over USB (preferred): `npm run dev`, then chrome://inspect → Port forwarding 5173 → localhost:5173,
  phone opens http://localhost:5173
- Dev over Wi-Fi (fallback, self-signed HTTPS): `npm run dev:wifi` → phone opens https://<laptop-ip>:5173
- Unit tests (pure DSP/ML in Node, synthetic taps): `npm test`
- Production build / local preview: `npm run build` / `npm run preview`
- Deploy: commit → `git push` (main) → Vercel auto-deploys to https://hum-navy.vercel.app
- Dev-only: the phone's "Send to laptop" button writes datasets to `data/` (gitignored) for offline analysis

## Non-negotiable rules (brief §9)
1. Never fake it: no hard-coded/scripted detections, no pretend "demo mode". If it fails, say so; cut or pivot.
2. Riskiest first, always working: main never broken, small commits, revert rather than pile on fixes.
3. Minimal deps, plain JS (Vite + vanilla ES modules, no framework/TS), readable code, "why"-level comments.
   Pre-approved deps: FFT lib/meyda, peerjs, qrcode, idb-keyval, vite-plugin-pwa,
   @vitejs/plugin-basic-ssl, @fontsource/*. Ask before anything else.
4. User is a beginner on Windows: numbered exact steps when they must act; otherwise just do the work.
   Short status updates, no lectures (teaching goes in docs/CHEATSHEET.md).
5. Honest claims: "assistive aid, not a medical device"; report real measured accuracy; credit research + libs.
6. Privacy: audio processed on-device, never uploaded; clips/debug recordings stored locally only.
7. Ask one short question (with a recommendation) before scope/story changes or big deps.
8. Keep this file current so a fresh session can continue exactly where we left off.

## Where things live
- `index.html` + `src/main.js` (boot) + `src/app.js` (state, navigation, tap routing) — phone app
- `src/screens/` — home (tables), wizard (setup §3.1), access (Access Pad §3.3), phrases (editor), lab (test + play)
- `src/gesture.js` — confirm/double-knock logic (pure, tested) · `src/voice.js` — TTS, clips, chime, buzz, guard
- `src/profile.js` — Surface Profiles: train/decide/self-check/advice/export (pure, tested) · `src/store.js` — IndexedDB
- `companion.html` + `src/companion.js` (+ companion.css) — caregiver feed, SOS takeover, Desk Remote player
- `src/link.js` — PeerJS link + protocol (both ends) · `src/phoneLink.js` — phone side · `src/screens/remote.js`
- `src/audio/` — worklet capture, ring buffer, onset detector, DSP (FFT/mel/MFCC), feature extraction
- `src/ml/knn.js` — z-score + weighted k-NN + leave-one-out cross-validation
- `src/ui/` — scope, table map, confusion matrix, debug panel · `test/` — Node tests
- `tools/analyze.js` — offline LOO/ablation on exported datasets (same code as the app; replaces the brief's analyze.py)
- `docs/` — brief, demo script, cheat sheet
