import { getAccountGroupsList, getAccounts } from "./auth.ts";
import { clearCache, getCacheStats } from "./cache.ts";
import { configExists } from "./config.ts";
import { isGogAvailable } from "./gmail.ts";
import {
  executeDone,
  executeOpen,
  executeStar,
  fetchAndAnalyze,
  filterByGroup,
  findTodoById,
  sortByUrgency,
} from "./pipeline.ts";
import type { ActionResult, ProgressCallback, SiftData } from "./pipeline.ts";
import type { Todo } from "./types.ts";

export type TodoView = "active" | "backlog";
export type TodoAction = "done" | "open" | "star";

export interface TodoSelection {
  group?: string;
  view: TodoView;
}

export interface TodoActionPreview {
  action: TodoAction;
  dryRun: true;
  id: string;
  summary: string;
  wouldDo: string[];
}

export interface SiftStatus extends Record<string, unknown> {
  accounts: { email: string; group: string; name: string }[];
  cache: {
    oldestAnalysis: number | null;
    todosCount: number;
    totalCached: number;
  };
  config: boolean;
  gogAvailable: boolean;
  groups: string[];
  securityPosture: string;
}

/** Fetch the canonical Sift data set used by CLI and TUI wrappers. */
export async function loadSiftData(onProgress?: ProgressCallback): Promise<SiftData> {
  return await fetchAndAnalyze(onProgress);
}

/** Select and sort todos for a visible view. */
export function selectTodos(data: SiftData, selection: TodoSelection): Todo[] {
  const source = selection.view === "backlog" ? data.backlog : data.active;
  const scoped = selection.group ? filterByGroup(source, selection.group) : source;

  if (selection.view === "backlog") {
    return [...scoped].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
      wouldDo: ["Unstar email", "Remove from cache"],
    };
  }

  return {
    action,
    dryRun: true,
    id: todo.id,
    summary: todo.summary,
    wouldDo: ["Star email in Gmail"],
  };
}

/** Execute a todo action against the canonical clients. */
export function runTodoAction(
  action: TodoAction,
  todo: Todo,
  data: Pick<SiftData, "clients">,
): ActionResult | Promise<ActionResult> {
  switch (action) {
    case "done": {
      return executeDone(todo, data.clients);
    }
    case "star": {
      return executeStar(todo, data.clients);
    }
    case "open": {
      return executeOpen(todo, data.clients);
    }
  }
}

/** Build the status payload used by CLI and MCP. */
export function getSiftStatus(): SiftStatus {
  const hasConfig = configExists();
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
    groups: hasConfig ? getAccountGroupsList() : [],
    securityPosture:
      "The agent is not a trusted operator. Validate IDs, prefer dry-run for mutations, and use fields or pagination to reduce context waste.",
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
