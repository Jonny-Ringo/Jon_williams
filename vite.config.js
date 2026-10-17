import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
