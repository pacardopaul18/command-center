/**
 * The dev server, backed by the real-data environment.
 *
 * A launcher rather than an inline `CC_DATA=real vite dev`, because that syntax
 * is a shell feature and npm runs scripts through cmd on Windows, where it is a
 * syntax error rather than an assignment. This works the same everywhere and
 * adds no dependency.
 *
 * The variable is read by vite.config.ts, which moves the whole miniflare state
 * directory. Nothing is shared with the fixture the suite reads.
 */
import { spawn } from 'node:child_process';

const child = spawn('npx', ['vite', 'dev'], {
	stdio: 'inherit',
	shell: true,
	env: { ...process.env, CC_DATA: 'real' }
});

child.on('exit', (code) => process.exit(code ?? 0));
