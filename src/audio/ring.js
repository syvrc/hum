// Multi-channel ring buffer: keeps the last few seconds of raw audio so that when the
// onset detector says "tap at sample N", we can cut out the window around N —
// including the 5 ms *before* the tap that has already scrolled past.

export class RingBuffer {
  /** @param {number} channels  @param {number} size power of two, in samples */
  constructor(channels, size = 1 << 17) {
    if ((size & (size - 1)) !== 0) throw new Error('RingBuffer size must be a power of two');
    this.size = size;
    this.mask = size - 1;
    this.data = Array.from({ length: channels }, () => new Float32Array(size));
    this.written = 0; // total samples ever written (absolute index of the next sample)
  }

  get channels() {
    return this.data.length;
  }

  /** Append one block (array of per-channel Float32Arrays of equal length). */
  write(block) {
    const n = block[0].length;
    const start = this.written & this.mask;
    const first = Math.min(n, this.size - start);
    for (let c = 0; c < this.data.length; c++) {
      const src = block[Math.min(c, block.length - 1)];
      this.data[c].set(src.subarray(0, first), start);
      if (first < n) this.data[c].set(src.subarray(first), 0);
    }
    this.written += n;
  }

  /** True if samples [start, start+length) are still in the buffer. */
  has(start, length) {
    return start >= 0 && start >= this.written - this.size && start + length <= this.written;
  }

  /** Copy samples [start, start+length) (absolute indices) into new Float32Arrays. */
  read(start, length) {
    if (!this.has(start, length)) throw new Error(`RingBuffer.read out of range: ${start}+${length} (written ${this.written})`);
    return this.data.map((ch) => {
      const out = new Float32Array(length);
      const s = start & this.mask;
      const first = Math.min(length, this.size - s);
      out.set(ch.subarray(s, s + first), 0);
      if (first < length) out.set(ch.subarray(0, length - first), first);
      return out;
    });
  }
}
