<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import FormField from './FormField.svelte';
	import Input from './Input.svelte';
	import Textarea from './Textarea.svelte';

	// Global capture, per the architecture's UX principles: reachable from
	// anywhere, keyboard first, sensible defaults. Defaults match the Action
	// Items form so an item captured here is indistinguishable from one typed
	// there: status open, deadline today plus two.
	//
	// This is what makes the brand-voice empty state wording true. Until it
	// existed, "add one with quick add, or press N" named two things that were
	// not there. See D27.

	let { open = $bindable(false), today }: { open?: boolean; today: string } = $props();

	let title = $state('');
	let context = $state('');
	let deadline = $state('');
	let busy = $state(false);
	let errorMessage = $state('');
	let titleInput = $state<HTMLInputElement | null>(null);

	function defaultDeadline() {
		const base = new Date(`${today}T00:00:00Z`);
		base.setUTCDate(base.getUTCDate() + 2);
		return base.toISOString().slice(0, 10);
	}

	// Reset every time it opens, so a cancelled capture never leaks into the next.
	$effect(() => {
		if (open) {
			title = '';
			context = '';
			deadline = defaultDeadline();
			errorMessage = '';
			queueMicrotask(() => titleInput?.focus());
		}
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!title.trim()) {
			errorMessage = 'Give the item a title.';
			return;
		}
		busy = true;
		errorMessage = '';
		try {
			const res = await fetch('/api/action-items', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title, context, deadline, status: 'open', source: 'manual' })
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				errorMessage = payload.error ?? 'Could not save the item.';
				return;
			}
			await invalidateAll();
			open = false;
		} catch {
			errorMessage = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title="Quick add">
	<form onsubmit={submit}>
		{#if errorMessage}
			<p class="error" role="alert">{errorMessage}</p>
		{/if}

		<div class="fields">
			<FormField label="Title">
				<Input
					bind:element={titleInput}
					bind:value={title}
					placeholder="What has to happen"
					maxlength={300}
					required
				/>
			</FormField>

			<FormField label="Deadline">
				<Input type="date" bind:value={deadline} mono />
			</FormField>

			<FormField label="Context" hint="Optional. One line so the item still makes sense later.">
				<Textarea bind:value={context} placeholder="What this was about" />
			</FormField>
		</div>

		<div class="actions">
			<Button type="submit" disabled={busy}>Add item</Button>
			<Button variant="secondary" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
		</div>
	</form>
</Modal>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.error {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--red-200);
		border-radius: var(--radius-sm);
		background: var(--red-100);
		color: var(--red);
	}
</style>
