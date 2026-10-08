// Audio engine: microphone → AudioWorklet → ring buffer → onset detector → tap windows.
// Emits a 'tap' event with the raw ~45 ms window around every detected knock.
// Everything stays in this browser tab — no audio is sent anywhere.

import { RingBuffer } from './ring.js';
import { OnsetDetector } from './onset.js';
import { WINDOW, preSamples } from './features.js';
import { log } from '../ui/log.js';

const CHUNK = 512;

export class AudioEngine extends EventTarget {
  constructor(detectorOpts = {}) {
    super();
    this.detectorOpts = detectorOpts;
    this.state = 'idle';
    this.pending = [];
    this.mutes = []; // [{from, to}] wall-clock intervals in which taps are ignored
    this.onsets = []; // recent onsets for the scope: { hop, label, ok }
    this.chunkCount = 0;
    this.inputLatencyMs = 0;
  }

  async start() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('Microphone needs a secure page (https:// or localhost).'), { code: 'insecure' });
    }
    this.state = 'starting';
    // Create the AudioContext *synchronously inside the tap* that called start():
    // browsers only allow audio to start from a user gesture, and the permission
    // prompt below can take longer than that gesture "lasts".
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    // Turn OFF the phone's voice processing: echo cancellation, noise suppression and
    // automatic gain all "clean up" exactly the knock transients we need to hear.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
      video: false,
    });
    this.track = this.stream.getAudioTracks()[0];
    this.trackSettings = this.track.getSettings();
    this.inputLatencyMs = typeof this.trackSettings.latency === 'number' ? this.trackSettings.latency * 1000 : 0;
    log('mic settings', this.trackSettings);
    this.track.addEventListener('ended', () => {
      log('mic track ended (another app may have taken the microphone)');
      this._setState('error');
    });

    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    this.ctx.addEventListener('statechange', () => log('AudioContext state:', this.ctx.state));
    // Vite turns this into a correct URL in dev and in the production build.
    await this.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));

    this.sr = this.ctx.sampleRate;
    this.pre = preSamples(this.sr);
    this.detector = new OnsetDetector(this.sr, this.detectorOpts);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    // channelCountMode 'max' + 'discrete': we receive exactly the channels the mic gives us
    // (no fake up-mixing), so we can tell honestly whether the phone exposes two mics.
    this.node = new AudioWorkletNode(this.ctx, 'hum-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCountMode: 'max',
      channelInterpretation: 'discrete',
      processorOptions: { chunk: CHUNK },
    });
    this.node.port.onmessage = (e) => this._onChunk(e.data.ch);
    // The worklet must be connected to the speakers to keep being processed, but at gain 0
    // so the microphone is never played back out loud.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.ctx.destination);
    log(`AudioContext ${this.sr} Hz, baseLatency ${(this.ctx.baseLatency * 1000).toFixed(1)} ms`);
    this._setState('running');
  }

  /** Resume after Android pauses audio (e.g. a phone call or another app). */
  async resume() {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
  }

  setDetector(opts) {
    Object.assign(this.detectorOpts, opts);
    this.detector?.set(opts);
  }

  /**
   * Ignore taps whose onset falls in [from, to] (performance.now() ms).
   * Used for the self-hearing guard (Hum's own sounds) and for screen touches —
   * touching the glass also makes a little knock that the mic hears.
   */
  mute(from, to) {
    const m = { from, to };
    this.mutes.push(m);
    if (this.mutes.length > 32) this.mutes.shift();
    return m; // callers may move m.to later (e.g. when speech ends early)
  }

  isMuted(t) {
    return this.mutes.some((m) => t >= m.from && t <= m.to);
  }

  _setState(s) {
    this.state = s;
    this.dispatchEvent(new CustomEvent('state', { detail: s }));
  }

  _onChunk(ch) {
    const now = performance.now();
    if (!this.ring) {
      this.ring = new RingBuffer(ch.length, 1 << 17);
      this.channels = ch.length;
      log(`receiving ${ch.length} channel(s)`);
    }
    this.chunkCount++;
    this.ring.write(ch);
    const found = this.detector.process(ch);
    for (const onset of found) {
      // When did this onset happen in wall-clock time? The newest sample arrived "now";
      // subtract how far back the onset is, plus the mic latency the browser reports.
      const onsetWall = now - ((this.ring.written - onset) / this.sr) * 1000 - this.inputLatencyMs;
      this.pending.push({ onset, onsetWall });
    }
    while (this.pending.length && this.pending[0].onset - this.pre + WINDOW <= this.ring.written) {
      const { onset, onsetWall } = this.pending.shift();
      const start = onset - this.pre;
      if (!this.ring.has(start, WINDOW)) continue;
      // Checked here (≈45 ms after the onset) rather than at detection, so a screen
      // touch whose event arrives a little after its sound is still caught.
      if (this.isMuted(onsetWall)) {
        log('tap ignored (screen touch or Hum sound)');
        continue;
      }
      const marker = { hop: Math.floor(onset / this.detector.hop), label: null, ok: null };
      this.onsets.push(marker);
      if (this.onsets.length > 32) this.onsets.shift();
      this.dispatchEvent(
        new CustomEvent('tap', {
          detail: {
            channels: this.ring.read(start, WINDOW),
            sr: this.sr,
            pre: this.pre,
            onsetAbs: onset,
            onsetWall,
            readyAt: now,
            marker,
          },
        }),
      );
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this._setState('idle');
  }
}
