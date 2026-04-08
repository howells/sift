import { spawnSync } from "node:child_process";
import { getThingsList, type SiftConfig } from "./config.ts";
import type { Todo } from "./types.ts";

export interface ThingsCreateOptions {
	deadline?: string;
	list?: string | null;
	notes?: string;
	title?: string;
	when?: string;
}

export interface ThingsCreateResult {
	backend: "things";
	error?: string;
	list?: string | null;
	success: boolean;
	url: string;
}

function normalizeIsoDate(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) {
		return undefined;
	}

	return new Date(timestamp).toISOString();
}

function deriveWhen(todo: Todo): string | undefined {
	if (todo.urgency === "overdue" || todo.urgency === "this_week") {
		return "today";
	}

	return undefined;
}

function buildThingsNotes(todo: Todo, notes?: string): string {
	const lines: string[] = [];

	if (todo.threadId) {
		lines.push(`https://mail.google.com/mail/u/0/#inbox/${todo.threadId}`, "");
	}

	if (notes) {
		lines.push(notes, "", `From: ${todo.from}`);
	} else {
		lines.push(`From: ${todo.from}`);
		if (todo.reasoning) {
			lines.push("", todo.reasoning);
		}
	}

	if (todo.emailId) {
		lines.push("", `sift-email-id:${todo.emailId}`);
	}

	return lines.join("\n");
}

export function isThingsAvailable(): boolean {
	const result = spawnSync("open", ["-Ra", "Things3"], { stdio: "pipe" });
	return result.status === 0;
}

export function buildThingsAddUrl(
	input: ThingsCreateOptions & { title: string },
): string {
	const params = new URLSearchParams();
	params.set("title", input.title);

	if (input.notes) {
		params.set("notes", input.notes);
	}
	if (input.list) {
		params.set("list", input.list);
	}
	if (input.when) {
		params.set("when", input.when);
	}
	if (input.deadline) {
		params.set("deadline", input.deadline);
	}

	return `things:///add?${params.toString()}`;
}

export function createThingsTodo(
	input: ThingsCreateOptions & { title: string },
): ThingsCreateResult {
	const url = buildThingsAddUrl(input);
	const result = spawnSync("open", [url], { stdio: "pipe" });

	if (result.status !== 0) {
		return {
			backend: "things",
			error: result.stderr?.toString() || "Failed to open Things URL",
			list: input.list ?? null,
			success: false,
			url,
		};
	}

	return {
		backend: "things",
		list: input.list ?? null,
		success: true,
		url,
	};
}

export function createThingsTodoFromTodo(
	todo: Todo,
	config: SiftConfig | null,
	options?: Pick<ThingsCreateOptions, "notes" | "title">,
): ThingsCreateResult {
	const title = options?.title ?? todo.summary;
	const deadline = normalizeIsoDate(todo.deadline ?? undefined);
	const when = deadline ? undefined : deriveWhen(todo);
	const notes = buildThingsNotes(todo, options?.notes);

	return createThingsTodo({
		deadline,
		list: getThingsList(config),
		notes,
		title,
		when,
	});
}
