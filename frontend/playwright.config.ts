import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (e2e/) drive a real browser through the built app.
// The app is built the way the public demo is: VITE_API_FALLBACK=only, so it runs on the
// saved answers of the real API (public/snapshot/) and needs neither a backend nor data files.

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'laptop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // A separate folder, so a test run never replaces a build made for deployment.
    command: `vite build --outDir dist-e2e && vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_API_FALLBACK: 'only' },
    // Always a fresh build: a server left from an earlier run could serve old code.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
