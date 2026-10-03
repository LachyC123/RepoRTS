import { defineConfig } from 'vite';

/**
 * `npm run build` → dist/ (cache-friendly chunks for hosting).
 * `npm run build:single` → dist-single/crownshire.html: one self-contained file (scripts, styles,
 * fonts and the terrain worker inlined) that runs when opened straight from disk or as an artifact.
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 4000,
      outDir: single ? 'dist-single' : 'dist',
      assetsInlineLimit: single ? 10_000_000 : 4096,
      cssCodeSplit: !single,
      modulePreload: !single,
      rollupOptions: {
        output: single
          ? { inlineDynamicImports: true }
          : // Phaser in its own chunk so game-code updates don't bust its cache
            { manualChunks: (id: string) => (id.includes('node_modules/phaser') ? 'phaser' : undefined) },
      },
    },
    server: { host: true },
  };
});
