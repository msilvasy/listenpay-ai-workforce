import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the ListenPay portal.
 *
 * By default Playwright builds the Angular app and serves it with server.mjs on E2E_PORT (4310),
 * so it never collides with `ng serve` (4200) or a manual `npm run serve` (3000).
 * Point E2E_BASE_URL at an already-running instance to skip the build, e.g.
 *   E2E_BASE_URL=http://localhost:3000 npx playwright test
 *
 * The .NET API (environment.listenPayUrl) is mocked in every test – see e2e/support/fixtures.ts –
 * so the suite runs without the API, a database or OpenAI.
 */
const port = Number(process.env['E2E_PORT'] ?? 4310);
const externalBaseUrl = process.env['E2E_BASE_URL'];
const baseURL = externalBaseUrl ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Skips the workspace's typewriter "streaming" reveal so assertions see final text immediately.
    contextOptions: { reducedMotion: 'reduce' },
    // The Angular app calls the API at https://localhost:5001 – requests are mocked, but this keeps
    // a stray real call from failing on the dev certificate.
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run build && node server.mjs',
        url: baseURL,
        env: { PORT: String(port) },
        reuseExistingServer: !process.env['CI'],
        timeout: 240_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
