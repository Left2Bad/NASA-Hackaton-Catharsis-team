import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Repository root: it holds the shared .env and the contract/ folder with examples for the mocks.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, repoRoot, 'VITE_');

  // Mocks are on in `npm run dev` and in tests, off in `npm run dev:api` and in the build.
  // The VITE_API_MOCKS=true|false variable overrides this rule.
  const useMocks = env.VITE_API_MOCKS
    ? env.VITE_API_MOCKS === 'true'
    : command === 'serve' && mode !== 'api';

  return {
    plugins: [react()],
    // Relative addresses of the built files: the site works from any folder of a static host.
    base: './',
    envDir: repoRoot,
    define: {
      __API_MOCKS__: JSON.stringify(useMocks),
    },
    server: {
      port: 5173,
      fs: { allow: [repoRoot] },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
    },
  };
});
