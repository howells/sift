/**
 * CLI surface for agent consumption.
 * All output is structured and sanitized for agent use.
 * Exit codes: 0 = success, 1 = error, 2 = validation error.
 */
import {
	applyFieldMaskToArray,
	applyFieldMaskToObject,
	type CommandSchema,
	getIntegerFlag,
	paginate,
	readJsonInput,
	sanitizeForAgentOutput,
	validateAgentText,
	validateIsoDate,
	writeAgentOutput,
} from "./lib/agent.ts";
import { getAccountGroupsList, getAccounts } from "./lib/auth.ts";
import { clearCache, getCacheStats } from "./lib/cache.ts";
import { type CalendarEvent, getCalendarToday } from "./lib/calendar.ts";
import { configExists, getTaskBackend, loadConfig } from "./lib/config.ts";
import { isGogAvailable } from "./lib/gmail.ts";
import { buildToolDiscovery, getLinearSummary } from "./lib/linear.ts";
import { executeLedgerMoneyCommand } from "./lib/money.ts";
import {
	executeDone,
	executeOpen,
	executeRemind,
	executeStar,
	fetchAndAnalyze,
	filterByGroup,
	findTodoById,
	sortByUrgency,
} from "./lib/pipeline.ts";
import {
	executePlacesCommand,
	isGooglePlacesConfigured,
	isGoPlacesAvailable,
} from "./lib/places.ts";
import {
	addReminder,
	completeReminder,
	deleteReminder,
	listReminders,
} from "./lib/reminders-cli.ts";
import { createThingsTodo, isThingsAvailable } from "./lib/things.ts";
import { aggregateToday } from "./lib/today.ts";
import { validateFields, validateGroup, validateId } from "./lib/validate.ts";

const VERSION = "0.2.0";
const SUPPORTED_FORMATS = ["json", "ndjson"] as const;
const CALENDAR_FIELDS = ["calendar", "end", "time", "title"] as const;
const LINEAR_FIELDS = ["error", "in_progress", "todo"] as const;
const PLACE_FIELDS = [
	"id",
	"name",
	"displayName",
	"formattedAddress",
	"shortFormattedAddress",
	"googleMapsUri",
	"websiteUri",
	"nationalPhoneNumber",
	"rating",
	"userRatingCount",
	"priceLevel",
	"types",
	"location",
	"businessStatus",
	"reviews",
	"photos",
] as const;
const REMINDER_DUE_FILTERS = ["all", "overdue", "today", "week"] as const;
const REMINDER_FIELDS = [
	"completed",
	"dueDate",
	"id",
	"listName",
	"notes",
	"priority",
	"title",
] as const;
const REMINDER_PRIORITY_VALUES = ["0", "1", "5", "9"] as const;
const STATUS_FIELDS = [
	"accounts",
	"cache",
	"config",
	"gogAvailable",
	"googlePlacesConfigured",
	"groups",
	"goplacesAvailable",
	"preferClaudeCli",
	"securityPosture",
	"taskBackend",
	"thingsAvailable",
] as const;
const TODAY_FIELDS = [
	"actions",
	"calendar",
	"date",
	"linear",
	"money",
	"reminders",
] as const;
const TODO_FIELDS = [
	"id",
	"emailId",
	"threadId",
	"account",
	"group",
	"subject",
	"from",
	"fromEmail",
	"summary",
	"actionType",
	"urgency",
	"reasoning",
	"date",
	"isStarred",
	"person",
	"deadline",
	"reminderState",
	"source",
	"reminderId",
] as const;

interface ParsedArgs {
	args: string[];
	command: string;
	commandPath: string[];
	flags: Map<string, string | true>;
}

const DOMAIN_SUBCOMMANDS: Record<string, Set<string>> = {
	cal: new Set(["today", "week", "tomorrow", "free", "add"]),
	email: new Set([
		"list",
		"done",
		"star",
		"remind",
		"open",
		"refresh",
		"status",
	]),
	linear: new Set(["mine", "issue", "update", "create", "search"]),
	money: new Set([
		"balance",
		"transactions",
		"invoice",
		"sync",
		"status",
		"runway",
		"forecast",
		"tax",
		"burn",
		"networth",
	]),
	places: new Set(["search", "resolve", "details"]),
	remind: new Set(["list", "add", "done", "delete"]),
};

export const COMMAND_SCHEMAS: Record<string, CommandSchema> = {
	help: {
		args: [],
		description: "Show command summary",
		examples: ["sift help"],
		flags: {},
		kind: "meta",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	describe: {
		args: [
			{
				description: "Optional command key to inspect",
				name: "command",
				required: false,
				type: "string",
			},
		],
		description: "Return machine-readable command schemas",
		examples: ["sift describe", "sift describe remind.add"],
		flags: {},
		kind: "meta",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	list: {
		args: [],
		description: "List prioritized todos",
		examples: [
			"sift list --fields=id,summary,urgency --limit=25",
			"sift list --group=personal --format=ndjson",
		],
		flags: {
			backlog: { description: "Show backlog items", type: "boolean" },
			fields: { description: "Comma-separated todo fields", type: "string" },
			format: {
				description: "Output format",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
			group: { description: "Account group filter", type: "string" },
			limit: { description: "Maximum items to return", type: "integer" },
			offset: { description: "Zero-based item offset", type: "integer" },
			"page-all": {
				description: "Return every page without slicing",
				type: "boolean",
			},
		},
		kind: "read",
		output: {
			fields: [...TODO_FIELDS],
			supportsFields: true,
			supportsNdjson: true,
			supportsPagination: true,
			type: "array",
		},
	},
	done: {
		args: [
			{
				description: "Todo or thread identifier",
				name: "id",
				required: false,
				type: "string",
			},
		],
		description: "Mark a todo as done",
		examples: [
			"sift done 19d42c92f393e035 --dry-run",
			'sift done --input=\'{"id":"19d42c92f393e035"}\' --dry-run',
		],
		flags: {
			"dry-run": {
				description: "Preview the action without side effects",
				type: "boolean",
			},
			input: {
				description: "Raw JSON object or '-' for stdin",
				type: "object",
			},
		},
		input: {
			description: "Raw payload with at least an id field",
			required: false,
			type: "json",
		},
		kind: "write",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	star: {
		args: [
			{
				description: "Todo or thread identifier",
				name: "id",
				required: false,
				type: "string",
			},
		],
		description: "Star an email-backed todo",
		examples: ["sift star 19d42c92f393e035 --dry-run"],
		flags: {
			"dry-run": {
				description: "Preview the action without side effects",
				type: "boolean",
			},
			input: {
				description: "Raw JSON object or '-' for stdin",
				type: "object",
			},
		},
		input: {
			description: "Raw payload with at least an id field",
			required: false,
			type: "json",
		},
		kind: "write",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	"email.remind": {
		args: [
			{
				description: "Todo or thread identifier",
				name: "id",
				required: false,
				type: "string",
			},
		],
		description: "Create an Apple Reminder from an email-backed todo",
		examples: ["sift remind 19d42c92f393e035 --dry-run"],
		flags: {
			"dry-run": {
				description: "Preview the action without side effects",
				type: "boolean",
			},
			input: {
				description: "Raw JSON object or '-' for stdin",
				type: "object",
			},
		},
		input: {
			description: "Raw payload with at least an id field",
			required: false,
			type: "json",
		},
		kind: "write",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	open: {
		args: [
			{
				description: "Todo or thread identifier",
				name: "id",
				required: false,
				type: "string",
			},
		],
		description: "Return a Gmail URL for a todo",
		examples: ["sift open 19d42c92f393e035"],
		flags: {
			input: {
				description: "Raw JSON object or '-' for stdin",
				type: "object",
			},
		},
		input: {
			description: "Raw payload with at least an id field",
			required: false,
			type: "json",
		},
		kind: "read",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	status: {
		args: [],
		description: "Show account and cache status",
		examples: ["sift status --fields=config,groups"],
		flags: {
			fields: {
				description: "Comma-separated top-level status fields",
				type: "string",
			},
			format: {
				description: "Output format",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
		},
		kind: "read",
		output: {
			fields: [...STATUS_FIELDS],
			supportsFields: true,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	refresh: {
		args: [],
		description: "Clear cache and re-fetch inbox state",
		examples: ["sift refresh --dry-run"],
		flags: {
			"dry-run": {
				description: "Preview the refresh without clearing cache",
				type: "boolean",
			},
		},
		kind: "write",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	today: {
		args: [],
		description: "Show the unified daily briefing",
		examples: ["sift today --fields=date,actions,money"],
		flags: {
			fields: {
				description: "Comma-separated top-level today fields",
				type: "string",
			},
			format: {
				description: "Output format",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
		},
		kind: "read",
		output: {
			fields: [...TODAY_FIELDS],
			supportsFields: true,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	"money.balance": {
		args: [],
		description: "List balances via @howells/ledger",
		examples: ["sift money balance --source=stripe --fields=id,balance"],
		flags: {
			fields: { description: "Delegated to ledger", type: "string" },
			format: {
				description: "Delegated to ledger",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
			limit: { description: "Delegated to ledger", type: "integer" },
			offset: { description: "Delegated to ledger", type: "integer" },
			"page-all": {
				description: "Delegated to ledger",
				type: "boolean",
			},
			source: { description: "Provider filter", type: "string" },
		},
		kind: "read",
		output: {
			supportsFields: true,
			supportsNdjson: true,
			supportsPagination: true,
			type: "array",
		},
	},
	"money.transactions": {
		args: [],
		description: "List transactions via @howells/ledger",
		examples: ["sift money transactions --source=starling --from=2026-01-01"],
		flags: {
			account: { description: "Delegated to ledger", type: "string" },
			fields: { description: "Delegated to ledger", type: "string" },
			format: {
				description: "Delegated to ledger",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
			from: { description: "Delegated to ledger", type: "string" },
			limit: { description: "Delegated to ledger", type: "integer" },
			offset: { description: "Delegated to ledger", type: "integer" },
			"page-all": {
				description: "Delegated to ledger",
				type: "boolean",
			},
			source: { description: "Provider filter", type: "string" },
			to: { description: "Delegated to ledger", type: "string" },
		},
		kind: "read",
		output: {
			supportsFields: true,
			supportsNdjson: true,
			supportsPagination: true,
			type: "array",
		},
	},
	"linear.mine": {
		args: [],
		description: "Show cached Linear summary",
		examples: ["sift linear mine --fields=in_progress,todo"],
		flags: {
			fields: { description: "Comma-separated summary fields", type: "string" },
			format: {
				description: "Output format",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
		},
		kind: "read",
		output: {
			fields: [...LINEAR_FIELDS],
			supportsFields: true,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	"places.search": {
		args: [
			{
				description: "Search query text",
				name: "query",
				required: true,
				type: "string",
			},
		],
		description: "Search places through goplaces",
		examples: [
			"sift places search 'coffee' --limit=5",
			"sift places search 'pizza' --open-now --min-rating=4 --fields=id,displayName,formattedAddress,rating",
		],
		flags: {
			fields: { description: "Comma-separated place fields", type: "string" },
			format: {
				description: "Output format",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
			keyword: {
				description: "Keyword to append to the query",
				type: "string",
			},
			language: { description: "BCP-47 language code", type: "string" },
			limit: { description: "Maximum results", type: "integer" },
			"min-rating": { description: "Minimum rating", type: "string" },
			"open-now": {
				description: "Filter to currently open places",
				type: "boolean",
			},
			"page-token": { description: "Delegated page token", type: "string" },
			"price-level": {
				description: "Comma-separated price levels",
				type: "string",
			},
			"radius-m": {
				description: "Radius in meters for location bias",
				type: "string",
			},
			region: { description: "CLDR region code", type: "string" },
			type: { description: "Included type filter", type: "string" },
			lat: { description: "Latitude for location bias", type: "string" },
			lng: { description: "Longitude for location bias", type: "string" },
		},
		kind: "read",
		output: {
			fields: [...PLACE_FIELDS],
			supportsFields: true,
			supportsNdjson: true,
			supportsPagination: true,
			type: "array",
		},
	},
	"places.resolve": {
		args: [
			{
				description: "Location string to resolve",
				name: "location",
				required: true,
				type: "string",
			},
		],
		description: "Resolve a location string through goplaces",
		examples: [
			"sift places resolve 'Soho, London' --limit=5",
			"sift places resolve 'Heathrow' --fields=id,displayName,formattedAddress",
		],
		flags: {
			fields: { description: "Comma-separated place fields", type: "string" },
			format: {
				description: "Output format",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
			language: { description: "BCP-47 language code", type: "string" },
			limit: { description: "Maximum results", type: "integer" },
			region: { description: "CLDR region code", type: "string" },
		},
		kind: "read",
		output: {
			fields: [...PLACE_FIELDS],
			supportsFields: true,
			supportsNdjson: true,
			supportsPagination: true,
			type: "array",
		},
	},
	"places.details": {
		args: [
			{
				description: "Place identifier",
				name: "place_id",
				required: true,
				type: "string",
			},
		],
		description: "Fetch place details through goplaces",
		examples: [
			"sift places details PLACE_ID --reviews",
			"sift places details PLACE_ID --fields=id,displayName,formattedAddress,websiteUri",
		],
		flags: {
			fields: { description: "Comma-separated place fields", type: "string" },
			language: { description: "BCP-47 language code", type: "string" },
			photos: { description: "Include photos", type: "boolean" },
			region: { description: "CLDR region code", type: "string" },
			reviews: { description: "Include reviews", type: "boolean" },
		},
		kind: "read",
		output: {
			fields: [...PLACE_FIELDS],
			supportsFields: true,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	"cal.today": {
		args: [],
		description: "Show today's calendar events",
		examples: ["sift cal today --fields=title,time --format=ndjson"],
		flags: {
			fields: { description: "Comma-separated event fields", type: "string" },
			format: {
				description: "Output format",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
			limit: { description: "Maximum items to return", type: "integer" },
			offset: { description: "Zero-based item offset", type: "integer" },
			"page-all": {
				description: "Return every page without slicing",
				type: "boolean",
			},
		},
		kind: "read",
		output: {
			fields: [...CALENDAR_FIELDS],
			supportsFields: true,
			supportsNdjson: true,
			supportsPagination: true,
			type: "array",
		},
	},
	"remind.list": {
		args: [],
		description: "List Apple Reminders via remindctl",
		examples: [
			"sift remind list --due=today --list=Work --fields=id,title,dueDate",
			"sift remind list --format=ndjson --page-all",
		],
		flags: {
			due: { description: "today|week|overdue|all", type: "string" },
			fields: {
				description: "Comma-separated reminder fields",
				type: "string",
			},
			format: {
				description: "Output format",
				enum: [...SUPPORTED_FORMATS],
				type: "string",
			},
			limit: { description: "Maximum items to return", type: "integer" },
			list: { description: "Reminder list name", type: "string" },
			offset: { description: "Zero-based item offset", type: "integer" },
			"page-all": {
				description: "Return every page without slicing",
				type: "boolean",
			},
		},
		kind: "read",
		output: {
			fields: [...REMINDER_FIELDS],
			supportsFields: true,
			supportsNdjson: true,
			supportsPagination: true,
			type: "array",
		},
	},
	"remind.add": {
		args: [
			{
				description: "Reminder title",
				name: "title",
				required: false,
				type: "string",
			},
		],
		description: "Create an Apple Reminder via remindctl",
		examples: [
			"sift remind add 'Follow up' --list=Work --due=2026-04-08 --dry-run",
			'sift remind add --input=\'{"title":"Follow up","list":"Work"}\' --dry-run',
		],
		flags: {
			"dry-run": {
				description: "Preview the reminder creation without side effects",
				type: "boolean",
			},
			due: { description: "Reminder due date", type: "string" },
			input: {
				description: "Raw JSON object or '-' for stdin",
				type: "object",
			},
			list: { description: "Reminder list name", type: "string" },
			notes: { description: "Reminder notes", type: "string" },
			priority: { description: "Reminder priority", type: "string" },
		},
		input: {
			description:
				"Raw payload with title and optional list/due/notes/priority",
			required: false,
			type: "json",
		},
		kind: "write",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	"remind.done": {
		args: [
			{
				description: "Reminder identifier",
				name: "id",
				required: false,
				type: "string",
			},
		],
		description: "Complete an Apple Reminder via remindctl",
		examples: ["sift remind done abc123 --dry-run"],
		flags: {
			"dry-run": {
				description: "Preview the completion without side effects",
				type: "boolean",
			},
			input: {
				description: "Raw JSON object or '-' for stdin",
				type: "object",
			},
		},
		input: {
			description: "Raw payload with at least an id field",
			required: false,
			type: "json",
		},
		kind: "write",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
	"remind.delete": {
		args: [
			{
				description: "Reminder identifier",
				name: "id",
				required: false,
				type: "string",
			},
		],
		description: "Delete an Apple Reminder via remindctl",
		examples: ["sift remind delete abc123 --dry-run"],
		flags: {
			"dry-run": {
				description: "Preview the deletion without side effects",
				type: "boolean",
			},
			input: {
				description: "Raw JSON object or '-' for stdin",
				type: "object",
			},
		},
		input: {
			description: "Raw payload with at least an id field",
			required: false,
			type: "json",
		},
		kind: "write",
		output: {
			supportsFields: false,
			supportsNdjson: false,
			supportsPagination: false,
			type: "object",
		},
	},
};

const HELP_COMMANDS = {
	"cal today": {
		args: [],
		description: "Show today's calendar events",
		flags: [
			"--fields=...",
			"--format=json|ndjson",
			"--limit=...",
			"--offset=...",
			"--page-all",
		],
	},
	describe: {
		args: ["[command]"],
		description: "Show machine-readable command schemas",
		flags: [],
	},
	done: {
		args: ["<id>"],
		description: "Mark todo as done",
		flags: ["--dry-run", "--input=JSON|-"],
	},
	"email list": {
		args: [],
		description: "List prioritized todos",
		flags: [
			"--group=...",
			"--fields=...",
			"--limit=...",
			"--offset=...",
			"--page-all",
			"--format=json|ndjson",
			"--backlog",
		],
	},
	help: { args: [], description: "Show this help", flags: [] },
	list: {
		args: [],
		description: "List prioritized todos",
		flags: [
			"--group=...",
			"--fields=...",
			"--limit=...",
			"--offset=...",
			"--page-all",
			"--format=json|ndjson",
			"--backlog",
		],
	},
	"linear mine": {
		args: [],
		description: "Show Linear summary",
		flags: ["--fields=..."],
	},
	"places details": {
		args: ["<place_id>"],
		description: "Fetch place details through goplaces",
		flags: [
			"--fields=...",
			"--reviews",
			"--photos",
			"--language=...",
			"--region=...",
		],
	},
	"places resolve": {
		args: ["<location>"],
		description: "Resolve a location string through goplaces",
		flags: [
			"--fields=...",
			"--format=json|ndjson",
			"--limit=...",
			"--language=...",
			"--region=...",
		],
	},
	"places search": {
		args: ["<query>"],
		description: "Search places through goplaces",
		flags: [
			"--fields=...",
			"--format=json|ndjson",
			"--limit=...",
			"--keyword=...",
			"--type=...",
			"--open-now",
			"--min-rating=...",
			"--price-level=...",
			"--lat=...",
			"--lng=...",
			"--radius-m=...",
			"--page-token=...",
		],
	},
	"money balance": {
		args: [],
		description: "List balances through @howells/ledger",
		flags: [
			"--source=...",
			"--fields=...",
			"--format=json|ndjson",
			"--limit=...",
			"--offset=...",
			"--page-all",
		],
	},
	"money transactions": {
		args: [],
		description: "List transactions through @howells/ledger",
		flags: [
			"--source=...",
			"--account=...",
			"--from=...",
			"--to=...",
			"--fields=...",
			"--format=json|ndjson",
			"--limit=...",
			"--offset=...",
			"--page-all",
		],
	},
	open: {
		args: ["<id>"],
		description: "Get URL for todo",
		flags: ["--input=JSON|-"],
	},
	refresh: {
		args: [],
		description: "Clear cache and re-fetch",
		flags: ["--dry-run"],
	},
	"remind add": {
		args: ["<title>"],
		description: "Create an Apple Reminder",
		flags: [
			"--list=...",
			"--due=...",
			"--notes=...",
			"--priority=...",
			"--dry-run",
			"--input=JSON|-",
		],
	},
	"remind delete": {
		args: ["<id>"],
		description: "Delete an Apple Reminder",
		flags: ["--dry-run", "--input=JSON|-"],
	},
	"remind done": {
		args: ["<id>"],
		description: "Complete an Apple Reminder",
		flags: ["--dry-run", "--input=JSON|-"],
	},
	"remind list": {
		args: [],
		description: "List Apple Reminders",
		flags: [
			"--due=...",
			"--list=...",
			"--fields=...",
			"--format=json|ndjson",
			"--limit=...",
			"--offset=...",
			"--page-all",
		],
	},
	remind: {
		args: ["<id>"],
		description: "Create Apple Reminder from todo",
		flags: ["--dry-run", "--input=JSON|-"],
	},
	star: {
		args: ["<id>"],
		description: "Star email in Gmail",
		flags: ["--dry-run", "--input=JSON|-"],
	},
	status: {
		args: [],
		description: "Show account and cache status",
		flags: ["--fields=..."],
	},
	today: {
		args: [],
		description: "Show the unified daily briefing",
		flags: ["--fields=..."],
	},
} satisfies Record<
	string,
	{ args: string[]; description: string; flags: string[] }
>;

function jsonOut(data: object, flags?: Map<string, string | true>): void {
	writeAgentOutput(data, flags);
}

function jsonErr(error: string, code = "ERROR"): never {
	process.stderr.write(
		`${JSON.stringify(sanitizeForAgentOutput({ error, code }))}\n`,
	);
	process.exit(1);
}

function validationErr(error: string): never {
	process.stderr.write(
		`${JSON.stringify(sanitizeForAgentOutput({ error, code: "VALIDATION_ERROR" }))}\n`,
	);
	process.exit(2);
}

function getReadOptions(
	flags: Map<string, string | true>,
	validFields: readonly string[],
): {
	error?: string;
	fields?: string;
	format?: string;
	limit: number | null;
	offset: number | null;
	pageAll: boolean;
} {
	const fields =
		typeof flags.get("fields") === "string"
			? (flags.get("fields") as string)
			: undefined;
	if (fields) {
		const result = validateFields(fields, [...validFields]);
		if (!result.valid) {
			return {
				error: result.error,
				limit: null,
				offset: null,
				pageAll: false,
			};
		}
	}

	const limit = getIntegerFlag(flags, "limit");
	const offset = getIntegerFlag(flags, "offset");

	if (flags.has("limit") && limit === null) {
		return {
			error: "limit must be a non-negative integer",
			limit: null,
			offset: null,
			pageAll: false,
		};
	}

	if (flags.has("offset") && offset === null) {
		return {
			error: "offset must be a non-negative integer",
			limit: null,
			offset: null,
			pageAll: false,
		};
	}

	const format =
		typeof flags.get("format") === "string"
			? (flags.get("format") as string)
			: undefined;
	if (
		format &&
		!SUPPORTED_FORMATS.includes(format as (typeof SUPPORTED_FORMATS)[number])
	) {
		return {
			error: `format must be one of: ${SUPPORTED_FORMATS.join(", ")}`,
			limit: null,
			offset: null,
			pageAll: false,
		};
	}

	return { fields, format, limit, offset, pageAll: flags.has("page-all") };
}

function shapeArrayOutput<T extends object>(
	items: T[],
	flags: Map<string, string | true>,
	validFields: readonly string[],
	extra: Record<string, unknown> = {},
): void {
	const options = getReadOptions(flags, validFields);
	if (options.error) {
		validationErr(options.error);
	}

	const masked = applyFieldMaskToArray(items, options.fields);
	const paged = paginate(masked, options);

	jsonOut(
		{
			...extra,
			items: paged.items,
			page: paged.page,
		},
		flags,
	);
}

function shapeObjectOutput(
	input: Record<string, unknown>,
	flags: Map<string, string | true>,
	validFields: readonly string[],
): void {
	const options = getReadOptions(flags, validFields);
	if (options.error) {
		validationErr(options.error);
	}

	jsonOut(applyFieldMaskToObject(input, options.fields), flags);
}

function extractPlacesItems(input: unknown): Record<string, unknown>[] | null {
	if (Array.isArray(input)) {
		return input.filter(
			(item): item is Record<string, unknown> =>
				typeof item === "object" && item !== null,
		);
	}

	if (input && typeof input === "object") {
		const record = input as Record<string, unknown>;
		if (Array.isArray(record.places)) {
			return record.places.filter(
				(item): item is Record<string, unknown> =>
					typeof item === "object" && item !== null,
			);
		}
	}

	return null;
}

/** Parse raw argv into a command path, positional args, and flag map. */
export function parseArgs(argv: string[]): ParsedArgs {
	const first = argv[0] || "help";
	const second = argv[1];
	const commandPath =
		DOMAIN_SUBCOMMANDS[first]?.has(second ?? "") &&
		second &&
		!second.startsWith("-")
			? [first, second]
			: [first];
	const command = commandPath.join(":");
	const args: string[] = [];
	const flags = new Map<string, string | true>();

	for (let i = commandPath.length; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) {
			continue;
		}

		if (arg.startsWith("--")) {
			const eqIndex = arg.indexOf("=");
			if (eqIndex > 0) {
				flags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
			} else {
				flags.set(arg.slice(2), true);
			}
		} else if (arg.startsWith("-")) {
			flags.set(arg.slice(1), true);
		} else {
			args.push(arg);
		}
	}

	return { command, commandPath, args, flags };
}

async function resolveIdInput(
	args: string[],
	flags: Map<string, string | true>,
): Promise<{ id: string; payload: Record<string, unknown> | null }> {
	const payload = await readJsonInput(flags);
	const payloadId = typeof payload?.id === "string" ? payload.id : null;
	const id = args[0] ?? payloadId;

	if (!id) {
		validationErr(
			'An id argument or JSON payload with {"id": ...} is required',
		);
	}

	const idCheck = validateId(id);
	if (!idCheck.valid) {
		validationErr(idCheck.error);
	}

	return { id, payload };
}

async function cmdList(flags: Map<string, string | true>): Promise<void> {
	const group =
		typeof flags.get("group") === "string"
			? (flags.get("group") as string)
			: undefined;
	const showBacklog = flags.has("backlog");

	if (group) {
		const groups = getAccountGroupsList();
		const result = validateGroup(group, groups);
		if (!result.valid) {
			validationErr(result.error);
		}
	}

	const data = await fetchAndAnalyze((step, message, detail) => {
		process.stderr.write(
			`${JSON.stringify({ progress: { step, message, detail } })}\n`,
		);
	});

	let todos = showBacklog ? data.backlog : data.active;
	if (group) {
		todos = filterByGroup(todos, group);
	}

	shapeArrayOutput(sortByUrgency(todos), flags, TODO_FIELDS, {
		groups: data.groups,
		view: showBacklog ? "backlog" : "active",
	});
}

async function cmdDone(
	args: string[],
	flags: Map<string, string | true>,
): Promise<void> {
	const { id } = await resolveIdInput(args, flags);
	const dryRun = flags.has("dry-run");
	const data = await fetchAndAnalyze();
	const allTodos = [...data.active, ...data.backlog];
	const todo = findTodoById(allTodos, id);

	if (!todo) {
		jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
	}

	if (dryRun) {
		jsonOut(
			{
				action: "done",
				dryRun: true,
				id: todo.id,
				summary: todo.summary,
				wouldDo: [
					todo.source === "email" ? "Unstar email" : "Complete reminder",
					todo.source === "email" ? "Mark as read" : null,
					todo.reminderState === "none" ? null : "Complete associated reminder",
					todo.source === "email" ? "Remove from cache" : null,
				].filter(Boolean),
			},
			flags,
		);
		return;
	}

	jsonOut(await executeDone(todo, data.clients), flags);
}

async function cmdStar(
	args: string[],
	flags: Map<string, string | true>,
): Promise<void> {
	const { id } = await resolveIdInput(args, flags);
	const dryRun = flags.has("dry-run");
	const data = await fetchAndAnalyze();
	const allTodos = [...data.active, ...data.backlog];
	const todo = findTodoById(allTodos, id);

	if (!todo) {
		jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
	}

	if (dryRun) {
		jsonOut(
			{
				action: "star",
				dryRun: true,
				id: todo.id,
				summary: todo.summary,
				wouldDo: ["Star email in Gmail"],
			},
			flags,
		);
		return;
	}

	jsonOut(executeStar(todo, data.clients), flags);
}

async function cmdEmailRemind(
	args: string[],
	flags: Map<string, string | true>,
): Promise<void> {
	const { id } = await resolveIdInput(args, flags);
	const dryRun = flags.has("dry-run");
	const data = await fetchAndAnalyze();
	const allTodos = [...data.active, ...data.backlog];
	const todo = findTodoById(allTodos, id);

	if (!todo) {
		jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
	}

	if (dryRun) {
		const config = loadConfig();
		const taskBackend = getTaskBackend(config);
		jsonOut(
			{
				action: "remind",
				backend: taskBackend,
				dryRun: true,
				id: todo.id,
				summary: todo.summary,
				wouldDo: [
					"Fetch email thread for context",
					"Generate reminder title with Claude",
					taskBackend === "things"
						? "Create Things to-do"
						: "Create Apple Reminder",
				],
			},
			flags,
		);
		return;
	}

	jsonOut(await executeRemind(todo, data.clients), flags);
}

async function cmdOpen(
	args: string[],
	flags: Map<string, string | true>,
): Promise<void> {
	const { id } = await resolveIdInput(args, flags);
	const data = await fetchAndAnalyze();
	const allTodos = [...data.active, ...data.backlog];
	const todo = findTodoById(allTodos, id);

	if (!todo) {
		jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
	}

	const result = executeOpen(todo, data.clients);
	if (result.success && result.error) {
		jsonOut(
			{ action: "open", id: todo.id, success: true, url: result.error },
			flags,
		);
		return;
	}

	jsonOut(result, flags);
}

function cmdStatus(flags: Map<string, string | true>): void {
	const hasConfig = configExists();
	const config = hasConfig ? loadConfig() : null;
	const gogAvailable = isGogAvailable();
	const goplacesAvailable = isGoPlacesAvailable();
	const taskBackend = getTaskBackend(config);
	const accounts = hasConfig ? getAccounts() : [];
	const groups = hasConfig ? getAccountGroupsList() : [];
	const cacheStats = getCacheStats();

	shapeObjectOutput(
		{
			accounts: accounts.map((account) => ({
				email: account.email,
				group: account.group,
				name: account.name,
			})),
			cache: {
				oldestAnalysis: cacheStats.oldestAnalysis,
				todosCount: cacheStats.todosCount,
				totalCached: cacheStats.totalCached,
			},
			config: hasConfig,
			gogAvailable,
			googlePlacesConfigured: isGooglePlacesConfigured(),
			groups,
			goplacesAvailable,
			preferClaudeCli: config?.preferClaudeCli ?? false,
			securityPosture:
				"The agent is not a trusted operator. Validate IDs, prefer dry-run for mutations, and use fields or pagination to reduce context waste.",
			taskBackend,
			thingsAvailable: isThingsAvailable(),
		},
		flags,
		STATUS_FIELDS,
	);
}

async function cmdRefresh(flags: Map<string, string | true>): Promise<void> {
	if (flags.has("dry-run")) {
		jsonOut(
			{
				action: "refresh",
				dryRun: true,
				wouldDo: [
					"Clear cache",
					"Fetch fresh Gmail state",
					"Re-run Claude analysis",
				],
			},
			flags,
		);
		return;
	}

	clearCache();
	process.stderr.write(
		`${JSON.stringify({ progress: { step: 0, message: "Cache cleared" } })}\n`,
	);

	const data = await fetchAndAnalyze((step, message, detail) => {
		process.stderr.write(
			`${JSON.stringify({ progress: { step, message, detail } })}\n`,
		);
	});

	jsonOut(
		{
			activeCount: data.active.length,
			backlogCount: data.backlog.length,
			groups: data.groups,
			refreshed: true,
		},
		flags,
	);
}

async function cmdToday(flags: Map<string, string | true>): Promise<void> {
	shapeObjectOutput(await aggregateToday(), flags, TODAY_FIELDS);
}

async function cmdMoney(
	subcommand: string | undefined,
	flags: Map<string, string | true>,
): Promise<void> {
	if (!subcommand) {
		validationErr("Usage: sift money <subcommand>");
	}

	jsonOut(await executeLedgerMoneyCommand(subcommand, flags), flags);
}

async function cmdLinear(
	subcommand: string | undefined,
	flags: Map<string, string | true>,
): Promise<void> {
	switch (subcommand) {
		case "mine":
			shapeObjectOutput(await getLinearSummary(), flags, LINEAR_FIELDS);
			return;
		case "issue":
		case "update":
		case "create":
		case "search":
			jsonOut({ error: `linear ${subcommand} not implemented yet` }, flags);
			return;
		default:
			validationErr("Usage: sift linear <mine|issue|update|create|search>");
	}
}

function cmdPlaces(
	subcommand: string | undefined,
	args: string[],
	flags: Map<string, string | true>,
): void {
	switch (subcommand) {
		case "search":
		case "resolve": {
			const query = args[0];
			if (!query) {
				validationErr(`Usage: sift places ${subcommand} <query>`);
			}

			const queryError = validateAgentText(subcommand, query);
			if (queryError) {
				validationErr(queryError);
			}

			const result = executePlacesCommand(subcommand, [query], flags);
			const items = extractPlacesItems(result);

			if (items) {
				shapeArrayOutput(items, flags, PLACE_FIELDS, {
					source: "goplaces",
				});
				return;
			}

			if (result && typeof result === "object" && !Array.isArray(result)) {
				if ("error" in result) {
					jsonOut(result as Record<string, unknown>, flags);
					return;
				}

				shapeObjectOutput(
					result as Record<string, unknown>,
					flags,
					PLACE_FIELDS,
				);
				return;
			}

			jsonOut({ result, source: "goplaces" }, flags);
			return;
		}
		case "details": {
			const placeId = args[0];
			if (!placeId) {
				validationErr("Usage: sift places details <place_id>");
			}

			const placeIdValidation = validateId(placeId);
			if (!placeIdValidation.valid) {
				validationErr(placeIdValidation.error);
			}

			const result = executePlacesCommand("details", [placeId], flags);
			if (result && typeof result === "object" && !Array.isArray(result)) {
				if ("error" in result) {
					jsonOut(result as Record<string, unknown>, flags);
					return;
				}

				shapeObjectOutput(
					result as Record<string, unknown>,
					flags,
					PLACE_FIELDS,
				);
				return;
			}

			jsonOut({ result, source: "goplaces" }, flags);
			return;
		}
		default:
			validationErr("Usage: sift places <search|resolve|details> [...]");
	}
}

function cmdCalendar(
	subcommand: string | undefined,
	flags: Map<string, string | true>,
): void {
	switch (subcommand) {
		case "today": {
			const result = getCalendarToday();
			if (Array.isArray(result)) {
				shapeArrayOutput(result as CalendarEvent[], flags, CALENDAR_FIELDS);
			} else {
				jsonOut(result, flags);
			}
			return;
		}
		case "week":
		case "tomorrow":
		case "free":
		case "add":
			jsonOut({ error: `cal ${subcommand} not implemented yet` }, flags);
			return;
		default:
			validationErr("Usage: sift cal <today|week|tomorrow|free|add>");
	}
}

function reminderListArgsFromFlags(
	flags: Map<string, string | true>,
): string[] {
	const args: string[] = [];
	const dueFlag = flags.get("due");
	const listFlag = flags.get("list");
	const due = typeof dueFlag === "string" ? dueFlag : null;
	const list = typeof listFlag === "string" ? listFlag : null;

	if (due) {
		const dueError = validateAgentText("due", due);
		if (dueError) {
			validationErr(dueError);
		}
		if (
			!REMINDER_DUE_FILTERS.includes(
				due as (typeof REMINDER_DUE_FILTERS)[number],
			)
		) {
			validationErr(`due must be one of: ${REMINDER_DUE_FILTERS.join(", ")}`);
		}
		args.push(`--due=${due}`);
	}

	if (list) {
		const listError = validateAgentText("list", list);
		if (listError) {
			validationErr(listError);
		}
		args.push(`--list=${list}`);
	}

	return args;
}

function getReminderItems(
	result: Record<string, unknown>,
): Record<string, unknown>[] | null {
	const items = Array.isArray(result.items)
		? result.items
		: Array.isArray(result.reminders)
			? result.reminders
			: null;
	if (!items) {
		return null;
	}

	return items.filter(
		(entry): entry is Record<string, unknown> =>
			Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
	);
}

async function cmdReminderSubcommand(
	subcommand: string | undefined,
	args: string[],
	flags: Map<string, string | true>,
): Promise<void> {
	const payload = await readJsonInput(flags);
	const config = loadConfig();
	const taskBackend = getTaskBackend(config);

	switch (subcommand) {
		case "list": {
			if (taskBackend === "things") {
				validationErr(
					"Things backend does not provide machine-readable list support yet. Use the Things app directly for browsing.",
				);
			}
			const result = listReminders([
				...args,
				...reminderListArgsFromFlags(flags),
			]);
			const items = getReminderItems(result);
			if (!items) {
				jsonOut(result, flags);
				return;
			}

			const { items: _items, reminders: _reminders, ...meta } = result;
			shapeArrayOutput(items, flags, REMINDER_FIELDS, meta);
			return;
		}
		case "add": {
			const title =
				args[0] ?? (typeof payload?.title === "string" ? payload.title : null);
			if (!title) {
				validationErr(
					'Usage: sift remind add <title> or --input={"title":...}',
				);
			}

			const list =
				(typeof payload?.list === "string" ? payload.list : null) ??
				(typeof flags.get("list") === "string"
					? (flags.get("list") as string)
					: null);
			const due =
				(typeof payload?.due === "string" ? payload.due : null) ??
				(typeof flags.get("due") === "string"
					? (flags.get("due") as string)
					: null);
			const notes =
				(typeof payload?.notes === "string" ? payload.notes : null) ??
				(typeof flags.get("notes") === "string"
					? (flags.get("notes") as string)
					: null);
			const priority =
				(typeof payload?.priority === "string" ? payload.priority : null) ??
				(typeof flags.get("priority") === "string"
					? (flags.get("priority") as string)
					: null);

			const titleError = validateAgentText("title", title);
			if (titleError) {
				validationErr(titleError);
			}
			if (list) {
				const listError = validateAgentText("list", list);
				if (listError) {
					validationErr(listError);
				}
			}
			if (due) {
				const dueError = validateIsoDate("due", due);
				if (dueError) {
					validationErr(dueError);
				}
			}
			if (notes) {
				const notesError = validateAgentText("notes", notes);
				if (notesError) {
					validationErr(notesError);
				}
			}
			if (
				priority &&
				!REMINDER_PRIORITY_VALUES.includes(
					priority as (typeof REMINDER_PRIORITY_VALUES)[number],
				)
			) {
				validationErr(
					`priority must be one of: ${REMINDER_PRIORITY_VALUES.join(", ")}`,
				);
			}

			const reminderArgs = [title];
			if (list) {
				reminderArgs.push(`--list=${list}`);
			}
			if (due) {
				reminderArgs.push(`--due=${due}`);
			}
			if (notes) {
				reminderArgs.push(`--notes=${notes}`);
			}
			if (priority) {
				reminderArgs.push(`--priority=${priority}`);
			}

			if (flags.has("dry-run")) {
				jsonOut(
					{
						action: "remind.add",
						args: reminderArgs,
						backend: taskBackend,
						dryRun: true,
					},
					flags,
				);
				return;
			}

			if (taskBackend === "things") {
				if (!isThingsAvailable()) {
					jsonErr("Things3 is not installed or cannot be opened", "ERROR");
				}

				jsonOut(
					createThingsTodo({
						deadline: due ?? undefined,
						list,
						notes: notes ?? undefined,
						title,
					}),
					flags,
				);
				return;
			}

			jsonOut(addReminder(reminderArgs), flags);
			return;
		}
		case "done":
		case "delete": {
			if (taskBackend === "things") {
				validationErr(
					"Things backend does not support remind done/delete yet. Use the Things app to manage completion and deletion.",
				);
			}
			const id =
				args[0] ?? (typeof payload?.id === "string" ? payload.id : null);
			if (!id) {
				validationErr(
					`Usage: sift remind ${subcommand} <id> or --input={"id":...}`,
				);
			}

			const idCheck = validateId(id);
			if (!idCheck.valid) {
				validationErr(idCheck.error);
			}

			if (flags.has("dry-run")) {
				jsonOut(
					{
						action: `remind.${subcommand}`,
						dryRun: true,
						id,
					},
					flags,
				);
				return;
			}

			jsonOut(
				subcommand === "done" ? completeReminder([id]) : deleteReminder([id]),
				flags,
			);
			return;
		}
		default:
			validationErr("Usage: sift remind <list|add|done|delete> [...]");
	}
}

function getDescribePayload(command?: string): Record<string, unknown> {
	if (!command) {
		return {
			commands: COMMAND_SCHEMAS,
			fields: TODO_FIELDS,
			tools: buildToolDiscovery(),
			version: VERSION,
		};
	}

	const normalized = command.replace(":", ".");
	const schema = COMMAND_SCHEMAS[normalized];
	if (!schema) {
		throw new Error(`Unknown command schema: ${command}`);
	}

	return {
		command: normalized,
		schema,
		version: VERSION,
	};
}

function cmdHelp(): void {
	const isJson = !process.stdout.isTTY;

	if (isJson) {
		jsonOut({
			commands: HELP_COMMANDS,
			defaults: {
				nonTtyOutput: "json",
				supportedFormats: SUPPORTED_FORMATS,
			},
			fields: TODO_FIELDS,
			tools: buildToolDiscovery(),
			version: VERSION,
		});
		return;
	}

	console.log(`
sift - AI-powered email triage

Commands:
  sift                  Start the interactive TUI
  sift list             List prioritized todos
  sift done <id>        Mark todo as done
  sift star <id>        Star email in Gmail
  sift remind <id>      Create Apple Reminder from email
  sift remind list      List Apple Reminders
  sift remind add       Create Apple Reminder
  sift places search    Search places via goplaces
  sift places resolve   Resolve a location via goplaces
  sift places details   Fetch place details via goplaces
  sift money balance    List balances via ledger
  sift money transactions List transactions via ledger
  sift today            Unified daily briefing
  sift open <id>        Get email URL
  sift refresh          Clear cache and re-fetch
  sift status           Show account and cache status
  sift describe         Show machine-readable command schemas
  sift help             Show this help

Agent flags:
  --fields=<f1,f2,...>  Select specific fields
  --limit=<n>           Page read results
  --offset=<n>          Offset paged reads
  --format=ndjson       Stream item records as NDJSON
  --dry-run             Preview mutation without executing
  --input=JSON|-        Pass raw JSON payload or read it from stdin

Examples:
  sift list --fields=id,summary,urgency --limit=20
  sift done --input='{"id":"19d42c92f393e035"}' --dry-run
  sift describe remind.add
`);
}

/** Entry point for the CLI -- dispatches to the appropriate command handler. */
export async function runCli(argv: string[]): Promise<void> {
	const { command, args, flags } = parseArgs(argv);

	try {
		switch (command) {
			case "email:list":
			case "list":
			case "ls":
				await cmdList(flags);
				break;
			case "email:done":
			case "done":
				await cmdDone(args, flags);
				break;
			case "email:star":
			case "star":
				await cmdStar(args, flags);
				break;
			case "email:remind":
			case "remind":
				await cmdEmailRemind(args, flags);
				break;
			case "remind:list":
			case "remind:add":
			case "remind:done":
			case "remind:delete":
				await cmdReminderSubcommand(command.split(":")[1], args, flags);
				break;
			case "email:open":
			case "open":
				await cmdOpen(args, flags);
				break;
			case "money:balance":
			case "money:transactions":
			case "money:invoice":
			case "money:sync":
			case "money:status":
			case "money:runway":
			case "money:forecast":
			case "money:tax":
			case "money:burn":
			case "money:networth":
				await cmdMoney(command.split(":")[1], flags);
				break;
			case "linear:mine":
			case "linear:issue":
			case "linear:update":
			case "linear:create":
			case "linear:search":
				await cmdLinear(command.split(":")[1], flags);
				break;
			case "places:search":
			case "places:resolve":
			case "places:details":
				cmdPlaces(command.split(":")[1], args, flags);
				break;
			case "cal:today":
			case "cal:week":
			case "cal:tomorrow":
			case "cal:free":
			case "cal:add":
				cmdCalendar(command.split(":")[1], flags);
				break;
			case "today":
				await cmdToday(flags);
				break;
			case "status":
				cmdStatus(flags);
				break;
			case "refresh":
				await cmdRefresh(flags);
				break;
			case "describe":
				jsonOut(getDescribePayload(args[0]), flags);
				break;
			case "help":
			case "--help":
			case "-h":
				cmdHelp();
				break;
			default:
				jsonErr(`Unknown command: ${command}. Run 'sift help' for usage.`);
		}
	} catch (error) {
		jsonErr(error instanceof Error ? error.message : "Unknown error");
	}
}
