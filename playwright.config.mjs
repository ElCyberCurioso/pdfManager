// Configuración de los tests E2E (Playwright + Chromium).
// Arranca el servidor estático de scripts/serve.mjs automáticamente.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    // Sin service worker durante los tests (evita cachés entre ejecuciones)
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/serve.mjs`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
