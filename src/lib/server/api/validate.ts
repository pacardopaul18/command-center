import { isValidDate } from '../dates';

/** Thrown by route handlers and turned into a JSON error by the Hono onError hook. */
export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** All input is validated server side. Nothing trusts the client. */
export function requiredText(value: unknown, field: string, max: number): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new ApiError(400, `${field} is required.`);
	}
	const trimmed = value.trim();
	if (trimmed.length > max) {
		throw new ApiError(400, `${field} must be ${max} characters or fewer.`);
	}
	return trimmed;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') {
		throw new ApiError(400, `${field} must be text.`);
	}
	const trimmed = value.trim();
	if (trimmed === '') return null;
	if (trimmed.length > max) {
		throw new ApiError(400, `${field} must be ${max} characters or fewer.`);
	}
	return trimmed;
}

export function optionalDate(value: unknown, field: string): string | null {
	const text = optionalText(value, field, 10);
	if (text === null) return null;
	if (!isValidDate(text)) {
		throw new ApiError(400, `${field} must be a date in YYYY-MM-DD format.`);
	}
	return text;
}

export function oneOf<T extends string>(
	value: unknown,
	allowed: readonly string[],
	field: string,
	fallback: T
): T {
	if (value === null || value === undefined || value === '') return fallback;
	if (typeof value !== 'string' || !allowed.includes(value)) {
		throw new ApiError(400, `${field} must be one of: ${allowed.join(', ')}.`);
	}
	return value as T;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		throw new ApiError(400, 'Request body must be JSON.');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new ApiError(400, 'Request body must be a JSON object.');
	}
	return parsed as Record<string, unknown>;
}
