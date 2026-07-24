import { existsSync } from 'node:fs'
import { join } from 'node:path'
import esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

// Native/heavy modules stay external and are shipped as real node_modules (electron-builder
// rebuilds better-sqlite3 for Electron's ABI). Everything else (our TS, ws) is bundled in.
const external = ['electron', 'better-sqlite3', 'ccxt']

// The bridge/shared sources are ESM and import siblings with an explicit ".js" extension (e.g.
// "./server.js"), but on disk they are ".ts". esbuild won't rewrite that, so map .js -> .ts when
// a sibling .ts actually exists (leaves real node_modules .js untouched).
const tsResolve = {
  name: 'ts-resolve',
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.resolveDir) return undefined
      const ts = join(args.resolveDir, args.path.replace(/\.js$/, '.ts'))
      return existsSync(ts) ? { path: ts } : undefined
    })
  },
}

// ESM output: Electron 33 supports an ESM main (.mjs), and - crucially - it lets ccxt resolve its
// ESM build (its CJS build require()s an ESM-only dep, which breaks under a CommonJS main). ESM has
// no __dirname/require, so the banner re-creates them for any bundled CJS interop.
const banner = {
  js: [
    "import { createRequire as __cr } from 'node:module';",
    "import { fileURLToPath as __f } from 'node:url';",
    "import { dirname as __d } from 'node:path';",
    'const require = __cr(import.meta.url);',
    'const __filename = __f(import.meta.url);',
    'const __dirname = __d(__filename);',
  ].join(''),
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external,
  banner,
  plugins: [tsResolve],
  sourcemap: true,
  logLevel: 'info',
}

const ctx = await esbuild.context({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
})

// The preload runs in the renderer's isolated world and must be CommonJS (no ESM banner). Tiny
// (contextBridge + ipcRenderer), so electron is the only external.
const preloadCtx = await esbuild.context({
  ...common,
  format: 'cjs',
  banner: {},
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs',
})

if (watch) {
  await ctx.watch()
  await preloadCtx.watch()
  console.log('[desktop] esbuild watching…')
} else {
  await ctx.rebuild()
  await preloadCtx.rebuild()
  await ctx.dispose()
  await preloadCtx.dispose()
}
