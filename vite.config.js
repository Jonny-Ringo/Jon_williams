import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { generateResume } from './scripts/generate-resume.js';
import { careerPath } from './scripts/resume-content.js';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'career-resume',
      async buildStart() {
        await generateResume();
      },
      configureServer(server) {
        let pending = Promise.resolve();
        server.watcher.on('change', (path) => {
          if (resolve(path) !== fileURLToPath(careerPath)) return;
          pending = pending
            .then(() => generateResume())
            .catch((error) => server.config.logger.error(error.stack));
        });
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
