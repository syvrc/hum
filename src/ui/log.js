// Tiny in-app logger: mirrors to the console (visible via chrome://inspect) and keeps
// the last lines for the on-phone debug panel and the copyable debug report.

const lines = [];
const listeners = new Set();
const t0 = performance.now();

export function log(...parts) {
  const text = parts
    .map((p) => (typeof p === 'string' ? p : safeJson(p)))
    .join(' ');
  const line = `${((performance.now() - t0) / 1000).toFixed(2).padStart(7)}  ${text}`;
  lines.push(line);
  if (lines.length > 300) lines.shift();
  console.log('[hum]', ...parts);
  listeners.forEach((fn) => fn(line));
}

export const logLines = () => lines.slice();
export const onLog = (fn) => listeners.add(fn);

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

window.addEventListener('error', (e) => log('ERROR', e.message, `${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => log('ERROR (promise)', String(e.reason?.message || e.reason)));
