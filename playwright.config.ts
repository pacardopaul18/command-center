import { defineConfig, devices } from '@playwright/test';

/**
 * Layer 3, against the local dev server carrying the volume seed.
 *
 * Uses the Chrome already installed on this machine rather than downloading
 * Playwright's own browsers, which keeps the suite runnable without a large
 * one-off fetch. `reuseExistingServer` means the dev server Paul is already
 * using is not restarted underneath him.
 */
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	outputDir: 'test-results',
	use: {
		baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:5173',
		channel: 'chrome',
		headless: true,
		viewport: { width: 1440, height: 900 },
		screenshot: 'only-on-failure'
	},
	projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
	webServer: {
		command: 'npx vite dev --port 5173 --strictPort',
		url: 'http://localhost:5173/api/health',
		reuseExistingServer: true,
		timeout: 120_000
	}
});
