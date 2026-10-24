import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'career-photo-links',
      // Vite fingerprints image sources, but leaves ordinary anchor URLs alone.
      // Keep each full-size link pointing at its image, including without JavaScript.
      transformIndexHtml: {
        order: 'post',
        handler: (html) =>
          html.replace(/href="[^"]+"(\s+data-work-photo>\s*<img\s+src="([^"]+)")/g, 'href="$2"$1'),
      },
    },
  ],
  build: {
    rolldownOptions: {
      output: {
        // Manifest gateways can treat encoded spaces as different path keys.
        sanitizeFileName: (name) => name.replace(/[^a-zA-Z0-9._/-]/g, '-'),
      },
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        career: resolve(import.meta.dirname, 'career/index.html'),
        analytics: resolve(import.meta.dirname, 'analytics/index.html'),
      },
    },
  },
});
