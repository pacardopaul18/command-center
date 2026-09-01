import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { depthOf, extensionOf, isNoise, nameOf, normalisePath, parentOf } from '../src/lib/dropbox-paths';

/**
 * The guarantees the Dropbox mirror rests on.
 *
 * Two of them are safety properties in the D70 sense: the capability does not
 * exist, so no later bug can reach it. The third is L2, which Paul ruled a hard
 * rule rather than a preference, and which is asserted here because it is the
 * kind of rule that gets broken by somebody reasonably reaching for the
 * convenient value.
 */

const ROOT = process.cwd();

/**
 * The code with the prose taken out.
 *
 * These tests search for forbidden words, and the files explain at length why
 * those words are forbidden. Searching the raw text finds the explanation and
 * fails on it, which would leave only two ways out: stop explaining, or weaken
 * the test. Reading code without comments is the third.
 */
function code(...parts: string[]): string {
	return readFileSync(join(ROOT, ...parts), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const scanScript = code('scripts', 'dropbox-scan.mjs');
const route = code('src', 'lib', 'server', 'api', 'dropbox.ts');
const server = code('src', 'lib', 'server', 'dropbox.ts');

describe('layer 2: nothing can write to Dropbox', () => {
	it('has no upload, move, delete or share route', () => {
		for (const word of ['upload', 'delete', 'move', 'copy_v2', 'share', 'create_folder', 'restore']) {
			expect(
				new RegExp(`\\b${word}\\b`, 'i').test(route),
				`The Dropbox route names "${word}". The mirror is read only in this phase: ` +
					'Dropbox is the source of truth and nothing in the app may change it. ' +
					'The absence of the surface is the mechanism, on the same reasoning as D70.'
			).toBe(false);
		}
	});

	it('serves no file contents', () => {
		for (const word of ['download', 'readFile', 'content', 'blob', 'arrayBuffer']) {
			expect(
				new RegExp(word, 'i').test(route),
				`The Dropbox route names "${word}". The mirror holds metadata: a map of where ` +
					'the client work is, never the client work.'
			).toBe(false);
		}
	});

	it('stores no bytes and no download link', () => {
		const schema = readFileSync(join(ROOT, 'migrations', '0034_dropbox_mirror.sql'), 'utf8');
		const files = schema.split('CREATE TABLE dropbox_files (')[1].split(');')[0];
		expect(files).not.toMatch(/\burl\b/i);
		expect(files).not.toMatch(/\bcontent\b|\bblob\b/i);
	});

	it('opens no file when it walks the folder', () => {
		for (const call of ['readFile', 'createReadStream', 'writeFile', 'unlink', 'rename', 'rmdir']) {
			expect(
				scanScript.includes(call),
				`The scan script calls ${call}. It reads names, sizes and times, and nothing else.`
			).toBe(false);
		}
	});
});

describe('layer 2: L2, activity is file level and never a folder date', () => {
	/**
	 * The rule Paul ruled hard: file-level activity via file modification times,
	 * never top-level folder dates. A synced Dropbox touches folder mtimes when
	 * it syncs, so a folder date says when the sync client last thought about
	 * the folder rather than when anybody did work in it, and reading one made
	 * dormant clients look active.
	 */

	it('never stats a directory in the scan', () => {
		// The scan calls lstat only on the file branch. If a stat ever moves
		// above the isDirectory check, the mtime becomes available to send by
		// accident, which is exactly how this rule gets broken.
		const directoryBranch = scanScript.split('if (entry.isDirectory()) {')[1]?.split('continue;')[0] ?? '';
		expect(directoryBranch).not.toBe('');
		for (const call of ['lstat', 'stat(', 'statSync', 'mtime', 'birthtime', 'ctime']) {
			expect(
				directoryBranch.includes(call),
				`The scan reads ${call} on a directory. L2 is a hard rule: a folder's own ` +
					'date is the sync client talking, not the client working.'
			).toBe(false);
		}
	});

	it('sends no modification time on a folder entry', () => {
		const folderPush = scanScript.match(/\{ kind: 'folder'[^}]*\}/)?.[0] ?? '';
		expect(folderPush).not.toBe('');
		expect(folderPush).not.toMatch(/modified_at|mtime/);
	});

	it('drops a folder modification time if one ever arrives', () => {
		// Belt as well as braces: the connector that follows is a different
		// source and could supply one. The ingest rejects it loudly rather than
		// storing a value a later query could find.
		expect(server).toMatch(/if \(entry\.modified_at\) reject\(/);
	});

	it('gives a folder no column of its own to hold a date', () => {
		const schema = readFileSync(join(ROOT, 'migrations', '0034_dropbox_mirror.sql'), 'utf8');
		const folders = schema.split('CREATE TABLE dropbox_folders (')[1].split(');')[0];
		expect(folders).not.toMatch(/\bmodified_at\b/);
		// It has last_activity instead, and the roll-up is the only thing that
		// sets it.
		expect(folders).toMatch(/last_activity TEXT/);
	});

	it('derives folder activity only from file modification times', () => {
		const rollup = server.split('export async function rollUpFolders')[1].split('export ')[0];
		expect(rollup).toMatch(/MAX\(modified_at\) FROM dropbox_files/);
		expect(rollup).not.toMatch(/dropbox_folders[^)]*\bmodified_at\b/);
	});
});

describe('layer 2: paths are one thing, not one per caller', () => {
	it('normalises Windows separators and the leading slash', () => {
		expect(normalisePath('MacGray\\Acme\\notes.docx')).toBe('/MacGray/Acme/notes.docx');
		expect(normalisePath('/MacGray//Acme/')).toBe('/MacGray/Acme');
		expect(normalisePath('')).toBe('/');
	});

	it('agrees on parent, name and depth', () => {
		expect(parentOf('/Team/Acme/Invoices')).toBe('/Team/Acme');
		expect(parentOf('/Team')).toBe('/');
		expect(parentOf('/')).toBe(null);
		expect(nameOf('/Team/Acme/Invoices')).toBe('Invoices');
		expect(depthOf('/')).toBe(0);
		expect(depthOf('/Team')).toBe(1);
		expect(depthOf('/Team/Acme')).toBe(2);
	});

	it('reads an extension without inventing one', () => {
		expect(extensionOf('report.XLSX')).toBe('xlsx');
		expect(extensionOf('archive.tar.gz')).toBe('gz');
		expect(extensionOf('README')).toBe(null);
		// A leading dot is a whole filename, not an extension.
		expect(extensionOf('.gitignore')).toBe(null);
		expect(extensionOf('trailing.')).toBe(null);
	});

	it('knows sync machinery from client work', () => {
		expect(isNoise('.DS_Store')).toBe(true);
		expect(isNoise('desktop.ini')).toBe(true);
		expect(isNoise('~$budget.xlsx')).toBe(true);
		expect(isNoise('Q3 budget.xlsx')).toBe(false);
	});

	it('uses the same ignore list in the scan script as in the app', () => {
		const appList = readFileSync(join(ROOT, 'src', 'lib', 'dropbox-paths.ts'), 'utf8');
		for (const name of ['.ds_store', 'desktop.ini', 'thumbs.db', '.dropbox']) {
			expect(appList).toContain(name);
			expect(
				scanScript.includes(name),
				`The scan script does not ignore ${name} but the app does. The two lists ` +
					'drifting means the counts depend on which side did the filtering.'
			).toBe(true);
		}
	});
});
