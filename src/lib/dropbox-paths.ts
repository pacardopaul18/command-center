/**
 * Path handling for the Dropbox mirror.
 *
 * Pure and shared on purpose: the local scan of the synced folder and the OAuth
 * connector that follows must agree on what a path is, or the same file would
 * arrive twice under two spellings and the mirror would double.
 *
 * Paths are stored the way Dropbox writes them: forward slashes, a leading
 * slash, no trailing one. A Windows scan supplies backslashes and a drive
 * letter, and normalising here rather than at the call site means there is one
 * definition of the key rather than one per caller.
 */

/** The canonical form of a path within the mirror root. */
export function normalisePath(relative: string): string {
	const forward = relative.replace(/\\/g, '/').replace(/\/+/g, '/');
	const trimmed = forward.replace(/\/+$/, '');
	if (trimmed === '' || trimmed === '/') return '/';
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** The folder a path sits in, or null for the root itself. */
export function parentOf(path: string): string | null {
	const p = normalisePath(path);
	if (p === '/') return null;
	const cut = p.lastIndexOf('/');
	return cut <= 0 ? '/' : p.slice(0, cut);
}

/** The last segment. The root has no name of its own worth reporting. */
export function nameOf(path: string): string {
	const p = normalisePath(path);
	if (p === '/') return '/';
	return p.slice(p.lastIndexOf('/') + 1);
}

/** How far below the root a path sits. The root is zero. */
export function depthOf(path: string): number {
	const p = normalisePath(path);
	if (p === '/') return 0;
	return p.split('/').length - 1;
}

/**
 * A file's extension: lower case, no dot, null when there is not one.
 *
 * A leading dot is a whole filename, not an extension. `.gitignore` has no
 * extension, and treating "gitignore" as one would put every dotfile in the
 * wrong bucket on a screen that groups by type.
 */
export function extensionOf(name: string): string | null {
	const cut = name.lastIndexOf('.');
	if (cut <= 0 || cut === name.length - 1) return null;
	const ext = name.slice(cut + 1).toLowerCase();
	return /^[a-z0-9]{1,12}$/.test(ext) ? ext : null;
}

/**
 * Names that are sync machinery rather than client work.
 *
 * Excluded from the mirror because they are noise in every count: a folder
 * whose newest file is a `.DS_Store` written by somebody's Finder has not had
 * work done in it, and a file count that includes desktop.ini overstates every
 * client by however many folders they have.
 */
const IGNORED = new Set([
	'.ds_store',
	'desktop.ini',
	'icon\r',
	'thumbs.db',
	'.dropbox',
	'.dropbox.attr',
	'.dropbox.cache'
]);

export function isNoise(name: string): boolean {
	return IGNORED.has(name.toLowerCase()) || name.startsWith('~$');
}
