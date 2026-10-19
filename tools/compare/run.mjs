// Runs a TypeScript tool from this folder with the app's own modules (via Vite's loader).
// Usage: node tools/compare/run.mjs <module.ts> [args…]
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [mod, ...args] = process.argv.slice(2);
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
});
try {
  const m = await server.ssrLoadModule(path.resolve(root, mod));
  await m.default(args);
} finally {
  await server.close();
}
