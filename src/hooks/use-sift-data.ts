import { useEffect, useMemo, useRef, useState } from "react";
import { getAccountGroupsList, getAccounts } from "../lib/auth.ts";
import { pruneOldEntries, removeCachedAnalysis } from "../lib/cache.ts";
import { analyzeEmails, generateReminderFromEmail } from "../lib/claude.ts";
import { configExists, getReminderLists, loadConfig } from "../lib/config.ts";
import { GmailClient, isGogAvailable } from "../lib/gmail.ts";
import {
  completeReminderByEmail,
  completeReminderById,
  createReminderFromTodo,
  fetchPendingReminders,
  getEmailReminderStates,
  isRemindctlAvailable,
  openRemindersApp,
} from "../lib/reminders.ts";
import type { ReminderState, Todo, View } from "../lib/types.ts";

interface LoadingState {
  active: boolean;
  message: string;
  step: number;
  detail?: string;
}

function splitTodosIntoActiveAndBacklog(
  todos: Todo[],
  cutoffDate: Date,
  reminderStates: Map<string, ReminderState>
): { active: Todo[]; backlog: Todo[] } {
  const active: Todo[] = [];
  const backlog: Todo[] = [];

  for (const todo of todos) {
    const todoWithReminder = {
      ...todo,
      reminderState:
        reminderStates.get(todo.emailId ?? "") ?? ("none" as ReminderState),
    };

    const todoDate = new Date(todo.date);
    if (todoDate < cutoffDate) {
      backlog.push(todoWithReminder);
    } else {
      active.push(todoWithReminder);
    }
  }

  return { active, backlog };
}

function setupGmailClients(
  accounts: ReturnType<typeof getAccounts>,
  setLoading: (fn: (l: LoadingState) => LoadingState) => void
): Map<string, GmailClient> {
  setLoading(() => ({ active: true, message: "Connecting to Gmail", step: 1 }));
  const clients = new Map<string, GmailClient>();

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    setLoading((l) => ({
      ...l,
      detail: `${account.name} (${i + 1}/${accounts.length})`,
    }));
    clients.set(account.name, new GmailClient(account.email));
  }

  return clients;
}

function validateSetup(
  setError: (msg: string | null) => void,
  setLoading: (fn: (l: LoadingState) => LoadingState) => void
): {
  config: ReturnType<typeof loadConfig>;
  reminderLists: ReturnType<typeof getReminderLists>;
} | null {
  if (!configExists()) {
    setError("No config found. Run 'sift --setup' to configure.");
    setLoading((l) => ({ ...l, active: false }));
    return null;
  }

  if (!isGogAvailable()) {
    setError(
      "'gog' CLI not found. Install it first: https://github.com/howells/gog"
    );
    setLoading((l) => ({ ...l, active: false }));
    return null;
  }

  const config = loadConfig();
  const reminderLists = config ? getReminderLists(config) : null;

  if (reminderLists?.length && !isRemindctlAvailable()) {
    setError(
      "'remindctl' CLI not found but reminder lists are configured. Install it or remove reminderLists from config."
    );
    setLoading((l) => ({ ...l, active: false }));
    return null;
  }

  return { config, reminderLists };
}

function fetchAllEmails(
  accounts: ReturnType<typeof getAccounts>,
  clients: Map<string, GmailClient>,
  setLoading: (fn: (l: LoadingState) => LoadingState) => void
): Promise<
  Array<{
    account: string;
    group: string;
    emails: Awaited<ReturnType<GmailClient["listStarred"]>>;
  }>
> {
  setLoading(() => ({ active: true, message: "Fetching emails", step: 2 }));

  return Promise.all(
    accounts.map(async (account) => {
      const client = clients.get(account.name);
      if (!client) {
        return { account: account.name, group: account.group, emails: [] };
      }
      const [starred, unread] = await Promise.all([
        client.listStarred(200),
        client.listUnread(100),
      ]);

      const starredIds = new Set(starred.map((e) => e.id));
      const combined = [...starred];
      for (const email of unread) {
        if (!starredIds.has(email.id)) {
          combined.push(email);
        }
      }

      return {
        account: account.name,
        group: account.group,
        emails: combined,
      };
    })
  );
}

export interface SiftState {
  // Data
  todos: Todo[];
  backlog: Todo[];
  currentList: Todo[];
  loading: LoadingState;
  error: string | null;

  // View state
  view: View;
  selectedIndex: number;
  selectedGroup: string | null;
  accountGroups: string[];
  backlogCount: number;

  // Navigation
  moveUp: () => void;
  moveDown: () => void;
  toggleBacklog: () => void;
  dismissBacklog: () => void;
  toggleGroup: (groupIndex: number) => void;

  // Actions
  markDone: () => void;
  starTodo: () => void;
  createReminder: () => void;
  openTodo: () => void;
  refresh: () => void;
}

const urgencyOrder = { overdue: 0, this_week: 1, when_you_can: 2 };

export function useSiftData(): SiftState {
  const [view, setView] = useState<View>("main");
  const [allTodos, setAllTodos] = useState<Todo[]>([]);
  const [allBacklog, setAllBacklog] = useState<Todo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadingState>({
    active: true,
    message: "Initializing...",
    step: 1,
  });
  const [error, setError] = useState<string | null>(null);
  const [gmailClients, setGmailClients] = useState<Map<string, GmailClient>>(
    new Map()
  );
  const [_refreshTrigger, setRefreshTrigger] = useState(0);
  const autoRefreshQueued = useRef(false);

  const accounts = getAccounts();
  const accountGroups = getAccountGroupsList();

  // --- Data loading ---

  useEffect(() => {
    async function init() {
      try {
        const setupValidation = validateSetup(setError, setLoading);
        if (!setupValidation) {
          return;
        }

        const { reminderLists } = setupValidation;

        pruneOldEntries(90);

        const clients = setupGmailClients(accounts, setLoading);
        setGmailClients(clients);

        const allEmails = await fetchAllEmails(accounts, clients, setLoading);

        const totalEmails = allEmails.reduce(
          (sum, a) => sum + a.emails.length,
          0
        );

        // Step 3: Analyze with Claude
        setLoading({
          active: true,
          message: "Analyzing with Claude",
          step: 3,
          detail: `${totalEmails} emails to check`,
        });

        const result = await analyzeEmails(
          allEmails,
          new Date(),
          (cached, toAnalyze) => {
            let detail: string;
            if (toAnalyze === 0) {
              detail = `All ${cached} from cache`;
            } else if (cached > 0) {
              detail = `${cached} cached, analyzing ${toAnalyze} new`;
            } else {
              detail = `Analyzing ${toAnalyze} emails`;
            }
            setLoading((l) => ({ ...l, detail }));
          }
        );

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const defaultList = reminderLists?.[0]?.list ?? "Work";
        const reminderStates = getEmailReminderStates(defaultList);

        const { active, backlog } = splitTodosIntoActiveAndBacklog(
          result.todos,
          thirtyDaysAgo,
          reminderStates
        );

        const finalActive = reminderLists?.length
          ? [...active, ...fetchPendingReminders(reminderLists).todos]
          : active;

        setAllTodos(finalActive);
        setAllBacklog(backlog);
        setLoading((l) => ({ ...l, active: false }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading((l) => ({ ...l, active: false }));
      }
    }

    init();
  }, [accounts]);

  // --- Filtered/sorted lists ---

  const filteredTodos = useMemo(
    () =>
      (selectedGroup
        ? allTodos.filter((t) => t.group === selectedGroup)
        : allTodos
      ).sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]),
    [allTodos, selectedGroup]
  );

  const filteredBacklog = useMemo(
    () =>
      (selectedGroup
        ? allBacklog.filter((t) => t.group === selectedGroup)
        : allBacklog
      ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [allBacklog, selectedGroup]
  );

  const currentList = view === "backlog" ? filteredBacklog : filteredTodos;

  // --- Helpers ---

  function updateTodoInList(todoId: string, updater: (t: Todo) => Todo): void {
    const update = (t: Todo) => (t.id === todoId ? updater(t) : t);
    if (view === "backlog") {
      setAllBacklog((prev) => prev.map(update));
    } else {
      setAllTodos((prev) => prev.map(update));
    }
  }

  function removeTodoFromList(todoId: string): void {
    if (view === "backlog") {
      setAllBacklog((prev) => prev.filter((t) => t.id !== todoId));
    } else {
      setAllTodos((prev) => {
        const newTodos = prev.filter((t) => t.id !== todoId);
        // Auto-refresh when list gets low
        if (
          newTodos.length < 5 &&
          !loading.active &&
          !autoRefreshQueued.current
        ) {
          autoRefreshQueued.current = true;
          setTimeout(() => {
            autoRefreshQueued.current = false;
            setLoading({
              active: true,
              message: "Fetching more emails",
              step: 1,
            });
            setRefreshTrigger((n) => n + 1);
          }, 100);
        }
        return newTodos;
      });
    }
  }

  function getDefaultReminderList(): string {
    const config = loadConfig();
    const reminderLists = config ? getReminderLists(config) : null;
    return reminderLists?.[0]?.list ?? "Work";
  }

  // --- Navigation ---

  function moveUp() {
    setSelectedIndex((i) => Math.max(0, i - 1));
  }

  function moveDown() {
    setSelectedIndex((i) => Math.min(currentList.length - 1, i + 1));
  }

  function toggleBacklog() {
    setView((v) => (v === "backlog" ? "main" : "backlog"));
    setSelectedIndex(0);
  }

  function dismissBacklog() {
    if (view === "backlog") {
      setView("main");
      setSelectedIndex(0);
    }
  }

  function toggleGroup(groupIndex: number) {
    if (groupIndex >= 1 && groupIndex <= accountGroups.length) {
      const group = accountGroups[groupIndex - 1];
      setSelectedGroup((current) => (current === group ? null : group));
      setSelectedIndex(0);
    }
  }

  // --- Todo actions ---

  function markDone() {
    const todo = currentList[selectedIndex];
    if (!todo) {
      return;
    }

    // Handle reminder-sourced todos
    if (todo.source === "reminder" && todo.reminderId) {
      completeReminderById(todo.reminderId);
      const newLength = currentList.filter((t) => t.id !== todo.id).length;
      removeTodoFromList(todo.id);
      setSelectedIndex((i) => Math.min(i, Math.max(0, newLength - 1)));
      return;
    }

    // Handle email-sourced todos
    if (todo.source === "email" && todo.emailId) {
      const emailId = todo.emailId;
      const client = gmailClients.get(todo.account);
      if (!client) {
        return;
      }

      // Complete associated reminder if it exists
      if (todo.reminderState !== "none") {
        completeReminderByEmail(emailId, getDefaultReminderList());
      }

      const newLength = currentList.filter((t) => t.id !== todo.id).length;

      Promise.all([client.unstar(emailId), client.markRead(emailId)]).then(
        () => {
          removeCachedAnalysis(emailId);
          removeTodoFromList(todo.id);
          setSelectedIndex((i) => Math.min(i, Math.max(0, newLength - 1)));
        }
      );
    }
  }

  function starTodo() {
    const todo = currentList[selectedIndex];
    if (!todo || todo.source === "reminder") {
      return;
    }

    if (!todo.isStarred && todo.emailId) {
      const client = gmailClients.get(todo.account);
      if (client) {
        const success = client.star(todo.emailId);
        if (success) {
          updateTodoInList(todo.id, (t) => ({ ...t, isStarred: true }));
        }
      }
    }
  }

  function createReminderAction() {
    const todo = currentList[selectedIndex];
    if (!todo || todo.source === "reminder" || todo.reminderState !== "none") {
      return;
    }

    const defaultList = getDefaultReminderList();

    // Async: fetch thread, generate with Claude, create reminder
    (async () => {
      const client = gmailClients.get(todo.account);
      if (!(client && todo.threadId)) {
        const result = createReminderFromTodo(todo, defaultList);
        if (result.success) {
          updateTodoInList(todo.id, (t) => ({
            ...t,
            reminderState: "pending" as ReminderState,
          }));
        }
        return;
      }

      // Optimistic UI: mark pending immediately
      updateTodoInList(todo.id, (t) => ({
        ...t,
        reminderState: "pending" as ReminderState,
      }));

      try {
        const thread = await client.getThread(todo.threadId);
        if (!thread) {
          createReminderFromTodo(todo, defaultList);
          return;
        }

        const reminderContent = await generateReminderFromEmail(
          thread,
          todo.summary
        );

        createReminderFromTodo(todo, defaultList, {
          title: reminderContent.title,
          notes: reminderContent.notes,
        });
      } catch {
        createReminderFromTodo(todo, defaultList);
      }
    })();
  }

  function openTodo() {
    const todo = currentList[selectedIndex];
    if (!todo) {
      return;
    }

    if (todo.source === "reminder") {
      openRemindersApp();
    } else if (todo.threadId) {
      const client = gmailClients.get(todo.account);
      if (client) {
        client.openInBrowser(todo.threadId);
      }
    }
  }

  function refresh() {
    setLoading({ active: true, message: "Connecting to Gmail", step: 1 });
    setAllTodos([]);
    setAllBacklog([]);
    setSelectedIndex(0);
    setView("main");
    setRefreshTrigger((n) => n + 1);
  }

  return {
    todos: filteredTodos,
    backlog: filteredBacklog,
    currentList,
    loading,
    error,
    view,
    selectedIndex,
    selectedGroup,
    accountGroups,
    backlogCount: allBacklog.length,

    moveUp,
    moveDown,
    toggleBacklog,
    dismissBacklog,
    toggleGroup,

    markDone,
    starTodo,
    createReminder: createReminderAction,
    openTodo,
    refresh,
  };
}
