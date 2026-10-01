import { defineConfig } from 'vitest/config';

// Focused test config for local verification. The app's vite.config.ts adds a
// build-time SHA define and is not needed for unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['work/**', 'node_modules/**', 'desktop-dlss5/**', '**/work/**']
  }
});
