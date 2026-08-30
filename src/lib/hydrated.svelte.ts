import { browser } from '$app/environment';

/**
 * Whether the client has taken over from the server rendered markup.
 *
 * Server rendered HTML is interactive-looking well before Svelte hydrates the
 * bindings behind it. Anything typed in that window lands in the DOM and never
 * reaches component state, so the form submits empty, the handler bails on its
 * own validation, and the screen says nothing at all. The suite found this by
 * accident: the same programmatic fill failed on first load and passed after a
 * reload.
 *
 * A fast typist on a cold load is in exactly the same race. So rather than
 * every caller learning to wait, the app declines input it cannot yet honour:
 * forms render disabled and enable themselves once this flips.
 *
 * It starts false even in the browser, because the first client render is the
 * hydration pass itself. The layout sets it in onMount, which runs after.
 */
class Hydration {
	#ready = $state(false);

	get ready(): boolean {
		return this.#ready;
	}

	markReady(): void {
		if (browser) this.#ready = true;
	}
}

export const hydration = new Hydration();
