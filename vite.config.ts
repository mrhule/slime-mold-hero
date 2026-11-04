import { defineConfig } from 'vite';
import { linkRelay } from './link/vite-plugin';

export default defineConfig({
  base: './',
  plugins: [linkRelay()],
  build: {
    rollupOptions: {
      // index.html is the game; commander.html is a stand-in commander for trying the link before Slime Mold has one
      input: { main: 'index.html', commander: 'commander.html' },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
