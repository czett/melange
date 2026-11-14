import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  base: '/companion/',
  plugins: [solid()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:9000',
      '/wallpapers': 'http://127.0.0.1:9000',
      '/ws': {
        target: 'ws://127.0.0.1:9000',
        ws: true,
      },
    },
  },
});
