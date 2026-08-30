/**
 * A stand-in for `standardwebhooks`, which this app does not use.
 *
 * The Anthropic SDK statically imports it from its webhooks module, and that
 * module is reachable from the SDK entry point even though nothing here calls
 * it. The package is an optional peer dependency and is not installed, so the
 * cron bundle failed to build the moment the scheduled handler started doing AI
 * work.
 *
 * Marking it external would move the failure from build time to runtime, since
 * a static import that cannot resolve throws when the module is evaluated. A
 * stub is the honest fix: the import resolves, nothing calls it, and anything
 * that ever does gets a clear error rather than a mysterious one.
 */
export class Webhook {
	constructor() {
		throw new Error(
			'Anthropic webhooks are not available in this app. Nothing should be calling this.'
		);
	}
}

export default { Webhook };
