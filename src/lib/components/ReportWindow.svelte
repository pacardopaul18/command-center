<script lang="ts">
	import Button from './Button.svelte';

	/**
	 * The date range a windowed report covers.
	 *
	 * Uncontrolled inputs holding their own values, submitted as a normal form
	 * navigation, so the window lives in the URL and a report stays linkable and
	 * re-runnable. Mirroring them into component state would buy live min and max
	 * attributes and cost keeping that state in step with every navigation.
	 *
	 * A reversed range is swapped on submit rather than rejected. The API returns
	 * a 400 for from after to, which would surface as an error page, and reading
	 * a backwards range the obvious way is kinder and never wrong.
	 */

	let { from, to }: { from: string; to: string } = $props();

	function onsubmit(event: SubmitEvent) {
		const form = event.currentTarget as HTMLFormElement;
		const a = form.elements.namedItem('from') as HTMLInputElement;
		const b = form.elements.namedItem('to') as HTMLInputElement;
		if (a.value && b.value && a.value > b.value) [a.value, b.value] = [b.value, a.value];
	}
</script>

<form class="window" data-sveltekit-noscroll {onsubmit}>
	<label>
		<span>From</span>
		<input type="date" name="from" value={from} />
	</label>
	<label>
		<span>To</span>
		<input type="date" name="to" value={to} />
	</label>
	<Button type="submit" variant="secondary">Run</Button>
</form>

<style>
	.window {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		padding: var(--space-4);
		border: 1px solid var(--border-thin);
		border-radius: var(--radius-md);
		background: var(--surface-card);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	input {
		/* 44px tap target, 16px on touch so iOS does not zoom on focus. D22, D23. */
		min-height: var(--tap);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-control);
		border-radius: var(--radius-sm);
		background: var(--white);
		color: var(--text-body);
		font-family: var(--font-sans);
		font-size: 16px;
	}

	@media (min-width: 720px) {
		input {
			font-size: var(--text-sm);
		}
	}

	input:focus-visible {
		outline: 2px solid var(--navy);
		outline-offset: 1px;
	}
</style>
