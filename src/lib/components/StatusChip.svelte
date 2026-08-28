<script lang="ts">
	// Ported from docs/design/components/data/StatusChip.jsx.
	// The export ships seven states; the app's action statuses are five of them,
	// plus ambiguous, which the export does not have. Every pair clears 4.5:1.

	type ChipTone =
		| 'open'
		| 'waiting'
		| 'blocked'
		| 'done'
		| 'ambiguous'
		| 'overdue'
		| 'atrisk'
		| 'ontrack';

	let {
		tone = 'open',
		label,
		size = 'md'
	}: { tone?: ChipTone; label: string; size?: 'sm' | 'md' } = $props();
</script>

<span class="chip tone-{tone}" class:sm={size === 'sm'}>{label}</span>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		padding: 3px var(--space-3);
		border-radius: var(--radius-pill);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.chip.sm {
		padding: 2px var(--space-2);
	}

	.tone-open {
		background: var(--chip-open-bg);
		color: var(--chip-open-fg);
	}
	.tone-waiting {
		background: var(--chip-waiting-bg);
		color: var(--chip-waiting-fg);
	}
	.tone-blocked {
		background: var(--chip-blocked-bg);
		color: var(--chip-blocked-fg);
	}
	.tone-done {
		background: var(--chip-done-bg);
		color: var(--chip-done-fg);
	}
	.tone-ambiguous {
		background: var(--chip-ambiguous-bg);
		color: var(--chip-ambiguous-fg);
	}
	.tone-overdue {
		background: var(--chip-overdue-bg);
		color: var(--chip-overdue-fg);
	}
	.tone-atrisk {
		background: var(--chip-atrisk-bg);
		color: var(--chip-atrisk-fg);
	}
	.tone-ontrack {
		background: var(--chip-ontrack-bg);
		color: var(--chip-ontrack-fg);
	}
</style>
