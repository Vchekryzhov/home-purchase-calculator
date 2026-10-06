import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/home-purchase-calculator/' : '/',
  plugins: [vue()],
  build: {
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: undefined } },
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*'],
      exclude: ['src/**/*.test.js', 'src/lib/model.characterization.json'],
      reporter: ['text-summary', 'html', 'json-summary'],
      thresholds: { lines: 80 },
    },
  },
});
