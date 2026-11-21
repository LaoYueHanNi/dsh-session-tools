/**
 * tsdown config for the browser client bundle (lib/client.js): the closure
 * factory artifact the web shell's module loader consumes. Mirrors the
 * harness's shared client preset — same banner/footer handoff, same
 * platform-module externals — but standalone, so this package builds itself
 * without the harness monorepo. The node half is built by tsc
 * (`pnpm run build`); this config only emits the client bundle.
 *
 * This package ships no CSS Modules, so the harness's lightningcss plugin is
 * omitted; every `import` in src/client is either a platform module (external)
 * or local TypeScript that inlines into the bundle.
 */

import { createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'

/**
 * Plugin id stamped into the loader handoff. Derived from package.json so the
 * bundle's registration id always equals the installed package name — the web
 * shell rejects a bundle whose __ModuleLoader__.load id differs from the
 * loader entry's package.
 */
const PLUGIN_ID: string = createRequire(import.meta.url)('./package.json').name

/**
 * The browser platform modules the web shell shares into its frozen module
 * table. The bundle resolves these through the loader's injected require
 * instead of inlining them (mirror of PLATFORM_MODULES in the harness web
 * shell); everything else is inlined.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

export default {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // Browser bundle lands next to the node half (single lib/ artifact dir);
  // the entryFileNames pin keeps it exactly lib/client.js. clean stays off —
  // a default clean would wipe the tsc-emitted node half.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    // Platform modules stay external: the loader's injected require answers
    // them from the module table.
    neverBundle: [...PLATFORM_MODULES],
    // Anything not in the module table must inline (the table cannot answer it).
    alwaysBundle: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig