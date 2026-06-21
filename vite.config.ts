import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // allow access via the cloudflared quick-tunnel (random hostname)
    allowedHosts: true,
    // single-origin: forward API calls to the Node embeddings service
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    setupFiles: ['tests/setup.ts'],
  },
});
