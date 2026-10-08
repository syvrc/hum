import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';
import fs from 'node:fs';

// Dev-only endpoint: the phone's "Send dataset to laptop" button POSTs its recorded
// taps here, and they are saved in ./data (gitignored). It only exists while
// `npm run dev` is running on YOUR laptop — production builds have no such route.
function humDevUpload() {
  return {
    name: 'hum-dev-upload',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__hum/upload', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
          size += c.length;
          if (size > 100 * 1024 * 1024) req.destroy();
          else chunks.push(c);
        });
        req.on('end', () => {
          const dir = resolve(import.meta.dirname, 'data');
          fs.mkdirSync(dir, { recursive: true });
          const file = `hum-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          fs.writeFileSync(resolve(dir, file), Buffer.concat(chunks));
          server.config.logger.info(`[hum] dataset saved: data/${file} (${(size / 1024).toFixed(0)} KB)`);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, file }));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // `npm run dev:wifi` uses a self-signed HTTPS cert so phones on the same Wi-Fi get a
  // secure context (needed for the mic). Plain `npm run dev` is for USB port-forwarding.
  plugins: [mode === 'wifi' && basicSsl(), humDevUpload()].filter(Boolean),
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    // Never inline the AudioWorklet as a data: URL — emit it as a real file so it is
    // cached by the PWA and loads like any other script.
    assetsInlineLimit: (file) => (file.endsWith('worklet.js') ? false : undefined),
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        companion: resolve(import.meta.dirname, 'companion.html'),
      },
    },
  },
}));
