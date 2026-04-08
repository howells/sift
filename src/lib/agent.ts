export interface CommandArgSchema {
	description: string;
	name: string;
	required: boolean;
	type: "string";
}

export interface CommandFlagSchema {
	description: string;
	enum?: string[];
	required?: boolean;
	type: "boolean" | "integer" | "object" | "string";
}

export interface CommandSchema {
	args: CommandArgSchema[];
	description: string;
	examples: string[];
	flags: Record<string, CommandFlagSchema>;
	input?: {
		description: string;
		required: boolean;
		type: "json";
	};
	kind: "meta" | "read" | "write";
	output: {
		fields?: string[];
		supportsFields: boolean;
		supportsNdjson: boolean;
		supportsPagination: boolean;
		type: "array" | "object";
	};
}

const PATH_TRAVERSAL_PATTERN = /\.\./;
const QUERY_FRAGMENT_PATTERN = /[?#]/;
const PERCENT_ENCODING_PATTERN = /%/;
const SUSPICIOUS_LINE_PATTERNS = [
	/^\s*(system|assistant|developer|tool)\s*:/i,
	/ignore\s+previous\s+instructions/i,
	/follow\s+these\s+steps/i,
	/<\/?(system|assistant|developer|tool)>/i,
] as const;

function hasControlChars(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
			return true;
		}
	}
	return false;
}

export function validateAgentText(label: string, value: string): string | null {
	if (!value) {
		return `${label} is required`;
	}

	if (value.length > 10_000) {
		return `${label} is too long`;
	}

	if (hasControlChars(value)) {
		return `${label} contains control characters`;
	}

	return null;
}

export function validateAgentIdentifier(
	label: string,
	value: string,
): string | null {
	const textError = validateAgentText(label, value);
	if (textError) {
		return textError;
	}

	if (PATH_TRAVERSAL_PATTERN.test(value)) {
		return `${label} contains path traversal`;
	}

	if (QUERY_FRAGMENT_PATTERN.test(value)) {
		return `${label} contains query or fragment characters`;
	}

	if (PERCENT_ENCODING_PATTERN.test(value)) {
		return `${label} contains percent encoding`;
	}

	return null;
}

export function validateIsoDate(label: string, value: string): string | null {
	const textError = validateAgentText(label, value);
	if (textError) {
		return textError;
	}

	if (Number.isNaN(Date.parse(value))) {
		return `${label} must be an ISO-8601 date`;
	}

	return null;
}

export function applyFieldMaskToArray<T extends object>(
	items: T[],
	fields: string | undefined,
): Record<string, unknown>[] {
	if (!fields) {
		return items as Record<string, unknown>[];
	}

	const requested = fields
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

	return items.map((item) =>
		applyFieldMaskToObject(item as Record<string, unknown>, fields, requested),
	);
}

export function applyFieldMaskToObject(
	input: object,
	fields: string | undefined,
	requestedFields?: string[],
): Record<string, unknown> {
	if (!fields) {
		return input as Record<string, unknown>;
	}

	const requested =
		requestedFields ??
		fields
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);

	const output: Record<string, unknown> = {};
	for (const field of requested) {
		if (field in input) {
			output[field] = (input as Record<string, unknown>)[field];
		}
	}
	return output;
}

export function getIntegerFlag(
	flags: Map<string, string | true>,
	key: string,
): number | null {
	const raw = flags.get(key);
	if (typeof raw !== "string") {
		return null;
	}

	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value) || value < 0) {
		return null;
	}

	return value;
}

export function paginate<T>(
	items: T[],
	options: { limit: number | null; offset: number | null; pageAll: boolean },
): {
	items: T[];
	page: {
		hasMore: boolean;
		limit: number | null;
		offset: number;
		returned: number;
		total: number;
	};
} {
	const offset = options.offset ?? 0;
	const limit = options.pageAll ? null : options.limit;
	const paged =
		limit === null ? items.slice(offset) : items.slice(offset, offset + limit);

	return {
		items: paged,
		page: {
			hasMore: offset + paged.length < items.length,
			limit,
			offset,
			returned: paged.length,
			total: items.length,
		},
	};
}

function sanitizeText(value: string): string {
	const withoutControlChars = Array.from(value)
		.filter((character) => {
			const code = character.charCodeAt(0);
			return !((code >= 0 && code <= 0x1f) || code === 0x7f);
		})
		.join("");

	return withoutControlChars
		.split("\n")
		.map((line) =>
			SUSPICIOUS_LINE_PATTERNS.some((pattern) => pattern.test(line))
				? `[untrusted-content] ${line}`
				: line,
		)
		.join("\n");
}

export function sanitizeForAgentOutput(value: unknown): unknown {
	if (typeof value === "string") {
		return sanitizeText(value);
	}

	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeForAgentOutput(entry));
	}

	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			output[key] = sanitizeForAgentOutput(entry);
		}
		return output;
	}

	return value;
}

export async function readJsonInput(
	flags: Map<string, string | true>,
): Promise<Record<string, unknown> | null> {
	const inline = flags.get("input");
	if (typeof inline === "string" && inline !== "-") {
		const parsed = JSON.parse(inline) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Raw input payload must be a JSON object");
		}
		return parsed as Record<string, unknown>;
	}

	if (inline === "-") {
		const stdin = await new Promise<string>((resolve, reject) => {
			let buffer = "";
			process.stdin.setEncoding("utf8");
			process.stdin.on("data", (chunk) => {
				buffer += chunk;
			});
			process.stdin.on("end", () => resolve(buffer));
			process.stdin.on("error", reject);
		});

		const parsed = JSON.parse(stdin) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Raw input payload must be a JSON object");
		}
		return parsed as Record<string, unknown>;
	}

	return null;
}

export function writeAgentOutput(
	data: object,
	flags?: Map<string, string | true>,
): void {
	const format = flags?.get("format");
	const sanitized = sanitizeForAgentOutput(data) as Record<string, unknown>;

	if (format === "ndjson" && Array.isArray(sanitized.items)) {
		for (const item of sanitized.items) {
			process.stdout.write(`${JSON.stringify({ type: "item", data: item })}\n`);
		}
		if (sanitized.page) {
			process.stdout.write(
				`${JSON.stringify({ type: "page", data: sanitized.page })}\n`,
			);
		}
		return;
	}

	process.stdout.write(`${JSON.stringify(sanitized)}\n`);
}
