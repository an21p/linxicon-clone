import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // allow access via the cloudflared quick-tunnel hostname
    allowedHosts: ['.trycloudflare.com'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
  worker: { format: 'es' },
});
