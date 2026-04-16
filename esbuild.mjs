import { build, context } from 'esbuild';
import { mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const hostConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  outfile: 'out/extension.js',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

const webviewConfig = {
  entryPoints: ['src/webview/index.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  outfile: 'out/webview.js',
  format: 'iife',
  sourcemap: true,
  logLevel: 'info',
};

mkdirSync('out', { recursive: true });

if (watch) {
  const h = await context(hostConfig);
  const w = await context(webviewConfig);
  await h.watch();
  await w.watch();
  console.log('watching...');
} else {
  await build(hostConfig);
  await build(webviewConfig);
}
