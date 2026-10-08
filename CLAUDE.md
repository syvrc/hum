# Hum — CLAUDE.md

**Pitch:** Hum turns any table into a touch surface. Lay an Android phone flat, teach it your knocks
in 30 s, and every kind of knock (palm/knuckle × 1–3) becomes a button — microphone + on-device ML only.
Hero mode "Access Pad" speaks phrases for people who can't reliably hit small touch targets.

Full spec: docs/BRIEF.md (verbatim brief — re-read the relevant section before each phase).

## Status
PIVOT DONE (user decision after a real-table trial: left/right/near/far could not be told apart) → brief §6 Plan B:
commands = TAP TYPE (palm, knuckle) × COUNT (1–3), anywhere on the table → 6 commands. 4–5 knocks = safety gap;
6+ knocks in ONE continuous burst = SOS (never accumulates across separate commands). Confirm = "Hum asks, you
answer": a pattern asks "…?", then ✋ once = say it, ✊ once = cancel, 4 s timeout, answers within 0.4 s ignored.
Phases 0–2 + 4 rebuilt on this model; Phase 3 SOS screen (countdown → siren/flash/vibrate → Companion alert → ack)
built. Phone-moved detection + online learning NOT done. Old location profiles load as `legacy` (set up again).
Verified: 43 unit tests; full flow in the browser with console-injected synthetic knocks. NOT yet on a real phone.
LIVE: https://hum-navy.vercel.app (auto-deploys from main; companion at /companion.html).
Next: user's phone test → wizard → Access Pad → Lab accuracy test (48 prompted patterns) → "Copy report" →
fill real numbers into docs → Phase 3 leftovers (phone-moved, online learning) → Phase 5 polish → Phase 7.
Decisions: no sound/vibration DURING a pattern (guard would swallow knocks); pattern gap 450 ms (setting
300–800). Every output mutes detection for its duration + 150 ms. Link = PeerJS; cancelled SOS is dropped
from the outbox if it never reached the Companion.
No-phone testing: stub getUserMedia from the console with synthetic knocks (test-only, never app code).

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
- `src/screens/` — home, wizard (setup), access (Access Pad), phrases, lab (pattern test + play), remote, sos
- `src/pads.js` — tap types + the 6 commands · `src/gesture.js` — RhythmController: patterns, ask/answer, SOS
- `src/voice.js` — TTS, clips, chime, buzz, beep, siren, self-hearing guard
- `src/profile.js` — Surface Profiles: train/decide/self-check/advice/export (pure, tested) · `src/store.js` — IndexedDB
- `companion.html` + `src/companion.js` (+ companion.css) — caregiver feed, SOS takeover, Desk Remote player
- `src/link.js` — PeerJS link + protocol (both ends) · `src/phoneLink.js` — phone side · `src/screens/remote.js`
- `src/audio/` — worklet capture, ring buffer, onset detector, DSP (FFT/mel/MFCC), feature extraction
- `src/ml/knn.js` — z-score + weighted k-NN + leave-one-out cross-validation
- `src/ui/` — scope, table map, confusion matrix, debug panel · `test/` — Node tests
- `tools/analyze.js` — offline LOO/ablation on exported datasets (same code as the app; replaces the brief's analyze.py)
- `docs/` — brief, demo script, cheat sheet
