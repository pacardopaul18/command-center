<script lang="ts">
	import './control.css';
	import { plainToRichText, sanitizeRichText } from '$lib/rich-text';

	/**
	 * One editor, for every field people write prose into.
	 *
	 * Ticket descriptions, project and client notes, meeting notes, SOP bodies
	 * and the Quick Add equivalents. One component, because the interesting case
	 * is the one that is easy to get right in some places and forget in others,
	 * and a second editor written later would have its own paste handling, its
	 * own idea of what is allowed and its own bugs.
	 *
	 * WHAT THIS COMPONENT IS NOT. It is not the security boundary. Anything it
	 * produces is parsed and rebuilt on the server by `sanitizeRichText` before
	 * it reaches the database, because a browser can post whatever it likes and
	 * a guard that lives only in the page is a guard an attacker skips. The
	 * sanitising here is for the reader's benefit: it keeps pasted content from
	 * dragging a website's fonts and colours into the app.
	 *
	 * `document.execCommand` is deprecated and is still what every browser
	 * implements for this. The alternative is a selection-and-range editor of
	 * several hundred lines, or a dependency. Neither is worth it for a field
	 * that wants bold, a list and a link.
	 */

	let {
		value = $bindable(''),
		/** An existing plain value, converted on first edit so nothing is lost. */
		plain = null,
		label,
		rows = 6,
		placeholder = ''
	}: {
		value?: string;
		plain?: string | null;
		label: string;
		rows?: number;
		placeholder?: string;
	} = $props();

	let editor = $state<HTMLElement | null>(null);
	let focused = $state(false);

	/**
	 * The starting content, written into the element once.
	 *
	 * A contenteditable cannot be bound the way an input can: writing to
	 * innerHTML on every change would move the caret to the start on every
	 * keystroke. So the element is seeded once and read from thereafter, and
	 * `value` is the output rather than the input.
	 */
	let seeded = false;
	$effect(() => {
		if (!editor || seeded) return;
		seeded = true;
		const start = sanitizeRichText(value) ?? plainToRichText(plain) ?? '';
		if (start) editor.innerHTML = start;
		// A field opened from an existing plain value has content the caller does
		// not know about yet. Publishing it now means saving without touching the
		// box keeps the text rather than clearing it.
		if (start && !value) value = start;
	});

	function read() {
		if (!editor) return;
		value = sanitizeRichText(editor.innerHTML) ?? '';
	}

	/**
	 * Paste arrives as the source's HTML, with its fonts, colours and tracking
	 * links attached. Parsed and rebuilt before it is inserted, so what lands in
	 * the box is what would have been stored anyway.
	 */
	function onPaste(event: ClipboardEvent) {
		const html = event.clipboardData?.getData('text/html');
		const text = event.clipboardData?.getData('text/plain');
		const cleaned = html ? sanitizeRichText(html) : plainToRichText(text ?? '');
		if (!cleaned) return;
		event.preventDefault();
		document.execCommand('insertHTML', false, cleaned);
		read();
	}

	function apply(command: string, argument?: string) {
		editor?.focus();
		document.execCommand(command, false, argument);
		read();
	}

	function addLink() {
		const url = window.prompt('Link address');
		if (!url) return;
		// The same rule the server applies, applied here too so the button cannot
		// create a link the save would silently drop.
		if (!/^(https?:|mailto:)/i.test(url.trim())) {
			window.alert('Links must start with http://, https:// or mailto:.');
			return;
		}
		apply('createLink', url.trim());
	}

	function onKeydown(event: KeyboardEvent) {
		if (!(event.ctrlKey || event.metaKey)) return;
		const key = event.key.toLowerCase();
		if (key === 'b' || key === 'i' || key === 'u') {
			// The browser does these itself, but only inside contenteditable and
			// only for these three. Intercepted so `value` updates with them.
			setTimeout(read, 0);
		}
	}

	const TOOLS: { label: string; title: string; run: () => void; mono?: boolean }[] = [
		{ label: 'B', title: 'Bold', run: () => apply('bold') },
		{ label: 'I', title: 'Italic', run: () => apply('italic') },
		{ label: 'U', title: 'Underline', run: () => apply('underline') },
		{ label: 'S', title: 'Strikethrough', run: () => apply('strikeThrough') },
		{ label: 'H', title: 'Heading', run: () => apply('formatBlock', '<h2>') },
		{ label: 'List', title: 'Bulleted list', run: () => apply('insertUnorderedList') },
		{ label: '1.', title: 'Numbered list', run: () => apply('insertOrderedList') },
		{ label: 'Quote', title: 'Block quote', run: () => apply('formatBlock', '<blockquote>') },
		{ label: 'Link', title: 'Add a link', run: addLink },
		{ label: 'Clear', title: 'Remove formatting', run: () => apply('removeFormat') }
	];
</script>

<div class="editor" class:focused>
	<!--
		A toolbar, not a row of loose buttons. Screen readers announce the group
		and its purpose, and every control says what it does rather than relying
		on a single letter that reads as "B". D22: 44px tap floor on each.
	-->
	<div class="toolbar" role="toolbar" aria-label="{label} formatting">
		{#each TOOLS as tool (tool.label)}
			<button
				type="button"
				class="tool"
				title={tool.title}
				aria-label={tool.title}
				onmousedown={(e) => e.preventDefault()}
				onclick={tool.run}
			>
				{tool.label}
			</button>
		{/each}
	</div>

	<!--
		The box. `role="textbox"` and the label make it an input to a screen
		reader rather than an unexplained region, and `aria-multiline` tells it
		that Enter inserts a line rather than submitting.
	-->
	<div
		bind:this={editor}
		class="box"
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-multiline="true"
		aria-label={label}
		data-placeholder={placeholder}
		style="min-height: {rows * 1.5}rem"
		oninput={read}
		onpaste={onPaste}
		onkeydown={onKeydown}
		onfocus={() => (focused = true)}
		onblur={() => {
			focused = false;
			read();
		}}
	></div>
</div>

<style>
	.editor {
		border: 1px solid var(--border-control);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		transition: border-color var(--transition-fast);
	}

	.editor:hover {
		border-color: var(--navy-500);
	}

	/* The whole control shows focus, because the box inside it has no border of
	   its own and a focus ring on an invisible element is no focus ring. */
	.editor.focused {
		border-color: var(--navy);
		outline: 2px solid var(--navy-500);
		outline-offset: 1px;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 2px;
		border-bottom: 1px solid var(--border-thin);
		background: var(--surface-hover);
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
	}

	.tool {
		min-width: var(--tap);
		min-height: var(--tap);
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		font-family: var(--font-sans);
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.tool:hover {
		background: var(--surface-card);
	}

	.tool:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: -2px;
	}

	.box {
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--text-base);
		line-height: var(--leading-normal);
		color: var(--ink);
		overflow-y: auto;
		max-height: 30rem;
	}

	.box:focus {
		outline: none;
	}

	/* The placeholder, which a contenteditable does not have. Shown only when
	   the box is genuinely empty, and never selectable or copyable. */
	.box:empty::before {
		content: attr(data-placeholder);
		color: var(--text-secondary);
		pointer-events: none;
	}

	.box :global(p) {
		margin: 0 0 var(--space-3);
	}

	.box :global(p:last-child) {
		margin-bottom: 0;
	}

	.box :global(h1),
	.box :global(h2) {
		margin: var(--space-3) 0 var(--space-2);
		font-size: 1rem;
		font-weight: 600;
	}

	.box :global(ul),
	.box :global(ol) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-5);
	}

	.box :global(blockquote) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-3);
		border-left: 3px solid var(--border-thin);
		color: var(--text-secondary);
	}

	.box :global(a) {
		color: var(--navy);
	}

	@media (pointer: coarse) {
		.box {
			font-size: var(--text-md);
		}
	}
</style>
