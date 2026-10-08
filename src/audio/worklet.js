// AudioWorklet processor — runs on the browser's real-time audio thread.
// Its only job: collect the raw microphone samples (128 at a time, the browser's
// block size) into 512-sample chunks (~11 ms) and hand them to the main thread.
// No analysis happens here, so this thread can never glitch.
// (AudioWorklet replaces the old ScriptProcessorNode, which ran on the busy UI thread.)

class HumCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunk = options?.processorOptions?.chunk || 512;
    this.nch = 0;
    this.buf = null;
    this.pos = 0;
  }

  alloc() {
    this.buf = Array.from({ length: this.nch }, () => new Float32Array(this.chunk));
    this.pos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true; // mic not connected (yet)
    const nch = Math.min(input.length, 2);
    if (nch !== this.nch) {
      this.nch = nch;
      this.alloc();
    }
    const n = input[0].length;
    let offset = 0;
    while (offset < n) {
      const take = Math.min(n - offset, this.chunk - this.pos);
      for (let c = 0; c < nch; c++) this.buf[c].set(input[c].subarray(offset, offset + take), this.pos);
      this.pos += take;
      offset += take;
      if (this.pos === this.chunk) {
        // Transfer (not copy) the buffers to the main thread, then start fresh ones.
        this.port.postMessage({ ch: this.buf }, this.buf.map((b) => b.buffer));
        this.alloc();
      }
    }
    return true;
  }
}

registerProcessor('hum-capture', HumCapture);
