import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // Phaser in its own chunk so game-code updates don't bust its cache
      output: { manualChunks: (id: string) => (id.includes('node_modules/phaser') ? 'phaser' : undefined) },
    },
  },
  server: { host: true },
});
