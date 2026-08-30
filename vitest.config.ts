import { defineConfig } from 'vitest/config';

/**
 * Layers 1, 2 and 4. Layer 3 is Playwright and has its own config.
 *
 * Single threaded on purpose: layer 2 creates and deletes rows in the same
 * database layer 1 counts, and parallel files would race each other into
 * failures that look like defects.
 */
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		pool: 'forks',
		poolOptions: { forks: { singleFork: true } },
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 30_000,
		reporters: ['default']
	}
});
