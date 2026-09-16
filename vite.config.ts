import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/home-purchase-calculator/' : '/',
  plugins: [vue()],
  build: {
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: undefined } },
  },
});
