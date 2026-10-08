# Hum — CLAUDE.md

**Pitch:** Hum turns any table into a touch surface. Lay an Android phone flat, teach it your knocks
in 30 s, and every spot and kind of tap becomes a button — microphone + on-device ML only.
Hero mode "Access Pad" speaks phrases for people who can't reliably hit small touch targets.

Full spec: docs/BRIEF.md (verbatim brief — re-read the relevant section before each phase).

## Status
Current phase: 0 — Spike & go/no-go. Code DONE (23 unit tests pass; full flow verified in browser with injected
synthetic audio). WAITING on the user's real-phone accuracy test (Mixed 4 preset first; Location 4 / Type 4 if borderline).
Next: get the report/dataset → `node tools/analyze.js data/<file>.json` → apply the §6 gate (≥85% go / 70–85% reduce /
<70% Plan B: tap type × rhythm) → Phase 1 (wizard, noise calibration, "not a command", profiles).
Repo: https://github.com/syvrc/hum (remote `origin`). Vercel: not yet imported.

## Commands (Windows, from repo root)
- Install deps: `npm install`
- Dev over USB (preferred): `npm run dev`, then chrome://inspect → Port forwarding 5173 → localhost:5173,
  phone opens http://localhost:5173
- Dev over Wi-Fi (fallback, self-signed HTTPS): `npm run dev:wifi` → phone opens https://<laptop-ip>:5173
- Unit tests (pure DSP/ML in Node, synthetic taps): `npm test`
- Production build / local preview: `npm run build` / `npm run preview`
- Deploy: commit → `git push` (main) → Vercel auto-deploys
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
- `index.html` + `src/main.js` — phone app · `companion.html` + `src/companion.js` — laptop/2nd phone
- `src/audio/` — worklet capture, ring buffer, onset detector, DSP (FFT/mel/MFCC), feature extraction
- `src/ml/knn.js` — z-score + weighted k-NN + leave-one-out cross-validation
- `src/ui/` — scope, table map, confusion matrix, debug panel · `test/` — Node tests
- `tools/analyze.js` — offline LOO/ablation on exported datasets (same code as the app; replaces the brief's analyze.py)
- `docs/` — brief, demo script, cheat sheet
