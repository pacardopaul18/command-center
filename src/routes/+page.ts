import { redirect } from '@sveltejs/kit';

// The Today cockpit is the MVP stage. Until it exists, Action Items is the
// landing screen.
export function load() {
	redirect(307, '/actions');
}
