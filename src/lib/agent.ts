interface CommandArgSchema {
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

const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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

/** Validate agent-provided text input for length and control characters. */
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

/** Validate an agent-provided identifier, rejecting path traversal and query fragments. */
/** Validate that a string is a parseable ISO-8601 date. */
export function validateIsoDate(label: string, value: string): string | null {
	const textError = validateAgentText(label, value);
	if (textError) {
		return textError;
	}

	if (Number.isNaN(Date.parse(value))) {
		return `${label} must be an ISO-8601 date`;
	}

	if (ISO_DATE_ONLY_PATTERN.test(value)) {
		const parsed = new Date(`${value}T00:00:00.000Z`);
		if (parsed.toISOString().slice(0, 10) !== value) {
			return `${label} must be a valid ISO-8601 date`;
		}
	}

	return null;
}

/** Filter each item in an array to only the requested comma-separated fields. */
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

/** Filter an object to only the requested comma-separated fields. */
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

/** Extract a non-negative integer from a CLI flag map, returning null if absent or invalid. */
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

/** Slice an array by offset/limit and return pagination metadata. */
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

/** Recursively strip control characters and tag suspicious prompt-injection lines. */
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

/** Read a JSON object from the `--input` flag value or stdin (when `--input=-`). */
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

/** Write structured output to stdout as JSON or NDJSON depending on the `--format` flag. */
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
