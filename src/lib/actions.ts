import { getAccountGroupsList, getAccounts } from "./auth.ts";
import { clearCache, getCacheStats } from "./cache.ts";
import {
	configExists,
	getTaskBackend,
	loadConfig,
	type TaskBackend,
} from "./config.ts";
import { isGogAvailable } from "./gmail.ts";
import {
	type ActionResult,
	executeDone,
	executeOpen,
	executeRemind,
	executeStar,
	fetchAndAnalyze,
	filterByGroup,
	findTodoById,
	type ProgressCallback,
	type SiftData,
	sortByUrgency,
} from "./pipeline.ts";
import { isGooglePlacesConfigured, isGoPlacesAvailable } from "./places.ts";
import { isThingsAvailable } from "./things.ts";
import type { Todo } from "./types.ts";

export type TodoView = "active" | "backlog";
export type TodoAction = "done" | "open" | "remind" | "star";

export interface TodoSelection {
	group?: string;
	view: TodoView;
}

export interface TodoActionPreview {
	action: TodoAction;
	backend?: TaskBackend;
	dryRun: true;
	id: string;
	summary: string;
	wouldDo: string[];
}

export interface SiftStatus extends Record<string, unknown> {
	accounts: Array<{ email: string; group: string; name: string }>;
	cache: {
		oldestAnalysis: number | null;
		todosCount: number;
		totalCached: number;
	};
	config: boolean;
	gogAvailable: boolean;
	googlePlacesConfigured: boolean;
	groups: string[];
	goplacesAvailable: boolean;
	preferClaudeCli: boolean;
	securityPosture: string;
	taskBackend: TaskBackend;
	thingsAvailable: boolean;
}

/** Fetch the canonical Sift data set used by CLI and TUI wrappers. */
export function loadSiftData(onProgress?: ProgressCallback): Promise<SiftData> {
	return fetchAndAnalyze(onProgress);
}

/** Select and sort todos for a visible view. */
export function selectTodos(data: SiftData, selection: TodoSelection): Todo[] {
	const source = selection.view === "backlog" ? data.backlog : data.active;
	const scoped = selection.group
		? filterByGroup(source, selection.group)
		: source;

	if (selection.view === "backlog") {
		return [...scoped].sort(
			(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
		);
	}

	return sortByUrgency(scoped);
}

/** Find a todo across active and backlog views. */
export function findSiftTodo(data: SiftData, id: string): Todo | undefined {
	return findTodoById([...data.active, ...data.backlog], id);
}

/** Return a dry-run description for a todo mutation. */
export function previewTodoAction(
	action: Exclude<TodoAction, "open">,
	todo: Todo,
): TodoActionPreview {
	if (action === "done") {
		return {
			action,
			dryRun: true,
			id: todo.id,
			summary: todo.summary,
			wouldDo: [
				todo.source === "email" ? "Unstar email" : "Complete reminder",
				todo.source === "email" ? "Mark as read" : null,
				todo.reminderState === "none" ? null : "Complete associated reminder",
				todo.source === "email" ? "Remove from cache" : null,
			].filter((item): item is string => Boolean(item)),
		};
	}

	if (action === "star") {
		return {
			action,
			dryRun: true,
			id: todo.id,
			summary: todo.summary,
			wouldDo: ["Star email in Gmail"],
		};
	}

	const taskBackend = getTaskBackend(loadConfig());
	return {
		action,
		backend: taskBackend,
		dryRun: true,
		id: todo.id,
		summary: todo.summary,
		wouldDo: [
			"Fetch email thread for context",
			"Generate reminder title with @howells/envelope",
			taskBackend === "things"
				? "Create Things to-do"
				: "Create Apple Reminder",
		],
	};
}

/** Execute a todo action against the canonical clients. */
export function runTodoAction(
	action: TodoAction,
	todo: Todo,
	data: Pick<SiftData, "clients">,
): ActionResult | Promise<ActionResult> {
	switch (action) {
		case "done":
			return executeDone(todo, data.clients);
		case "star":
			return executeStar(todo, data.clients);
		case "remind":
			return executeRemind(todo, data.clients);
		case "open":
			return executeOpen(todo, data.clients);
	}
}

/** Build the status payload used by CLI and MCP. */
export function getSiftStatus(): SiftStatus {
	const hasConfig = configExists();
	const config = hasConfig ? loadConfig() : null;
	const cacheStats = getCacheStats();

	return {
		accounts: hasConfig
			? getAccounts().map((account) => ({
					email: account.email,
					group: account.group,
					name: account.name,
				}))
			: [],
		cache: {
			oldestAnalysis: cacheStats.oldestAnalysis,
			todosCount: cacheStats.todosCount,
			totalCached: cacheStats.totalCached,
		},
		config: hasConfig,
		gogAvailable: isGogAvailable(),
		googlePlacesConfigured: isGooglePlacesConfigured(),
		groups: hasConfig ? getAccountGroupsList() : [],
		goplacesAvailable: isGoPlacesAvailable(),
		preferClaudeCli: config?.preferClaudeCli ?? false,
		securityPosture:
			"The agent is not a trusted operator. Validate IDs, prefer dry-run for mutations, and use fields or pagination to reduce context waste.",
		taskBackend: getTaskBackend(config),
		thingsAvailable: isThingsAvailable(),
	};
}

/** Clear cached analysis and reload fresh Sift data. */
export async function refreshSiftData(
	onProgress?: ProgressCallback,
): Promise<{ activeCount: number; backlogCount: number; groups: string[] }> {
	clearCache();
	onProgress?.(0, "Cache cleared");

	const data = await loadSiftData(onProgress);
	return {
		activeCount: data.active.length,
		backlogCount: data.backlog.length,
		groups: data.groups,
	};
}
