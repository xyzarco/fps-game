import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: {
    // headless chromium biasa (headless-shell gagal diunduh di env ini)
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] },
    viewport: { width: 1280, height: 720 },
  },
  webServer: [
    { command: 'npx tsx src/index.ts', url: 'http://localhost:2567/__healthcheck', cwd: 'apps/server', reuseExistingServer: true, timeout: 30000 },
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', cwd: 'apps/client', reuseExistingServer: true, timeout: 30000 },
  ],
});
