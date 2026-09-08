import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const e2eDataRoot = process.env.RURAL_E2E_DATA_ROOT ?? path.join(
  os.tmpdir(),
  `rural-floor-plan-editor-e2e-${process.pid}`,
);
// Workers reload this config with another PID; keep fixture writers and server
// on the same isolated root by inheriting the coordinator's chosen directory.
process.env.RURAL_E2E_DATA_ROOT = e2eDataRoot;
const e2ePort = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/test-results',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    headless: true,
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run server',
    url: `http://localhost:${e2ePort}`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      EXIT_WITH_PARENT: '1',
      NODE_ENV: 'production',
      PORT: String(e2ePort),
      RURAL_DATA_ROOT: e2eDataRoot,
    },
  },
});
