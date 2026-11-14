import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Корень репозитория: там лежат общий .env и папка contract/ с примерами для моков.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, repoRoot, 'VITE_');

  // Моки включены в `npm run dev` и в тестах, выключены в `npm run dev:api` и в сборке.
  // Переменная VITE_API_MOCKS=true|false переопределяет это правило.
  const useMocks = env.VITE_API_MOCKS
    ? env.VITE_API_MOCKS === 'true'
    : command === 'serve' && mode !== 'api';

  return {
    plugins: [react()],
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
