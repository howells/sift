import { useEffect, useMemo, useRef, useState } from "react";
import { getAccountGroupsList, getAccounts } from "../lib/auth.js";
import { pruneOldEntries, removeCachedAnalysis } from "../lib/cache.js";
import { analyzeEmails, generateReminderFromEmail } from "../lib/claude.js";
import { configExists, getReminderLists, loadConfig } from "../lib/config.js";
import { GmailClient, isGogAvailable } from "../lib/gmail.js";
import {
  completeReminderByEmail,
  completeReminderById,
  createReminderFromTodo,
  fetchPendingReminders,
  getEmailReminderStates,
  isRemindctlAvailable,
  openRemindersApp,
} from "../lib/reminders.js";
import type { ReminderState, Todo, View } from "../lib/types.js";

interface LoadingState {
  active: boolean;
  message: string;
  step: number;
  detail?: string;
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
        if (!configExists()) {
          setError("No config found. Run 'sift --setup' to configure.");
          setLoading((l) => ({ ...l, active: false }));
          return;
        }

        if (!isGogAvailable()) {
          setError(
            "'gog' CLI not found. Install it first: https://github.com/howells/gog"
          );
          setLoading((l) => ({ ...l, active: false }));
          return;
        }

        const config = loadConfig();
        const reminderLists = config ? getReminderLists(config) : null;

        if (reminderLists?.length && !isRemindctlAvailable()) {
          setError(
            "'remindctl' CLI not found but reminder lists are configured. Install it or remove reminderLists from config."
          );
          setLoading((l) => ({ ...l, active: false }));
          return;
        }

        pruneOldEntries(90);

        // Step 1: Connect to accounts
        setLoading({ active: true, message: "Connecting to Gmail", step: 1 });
        const clients = new Map<string, GmailClient>();

        for (let i = 0; i < accounts.length; i++) {
          const account = accounts[i];
          setLoading((l) => ({
            ...l,
            detail: `${account.name} (${i + 1}/${accounts.length})`,
          }));
          clients.set(account.name, new GmailClient(account.email));
        }

        setGmailClients(clients);

        // Step 2: Fetch emails from all accounts in parallel
        setLoading({ active: true, message: "Fetching emails", step: 2 });

        const allEmails = await Promise.all(
          accounts.map(async (account) => {
            const client = clients.get(account.name)!;
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
            const detail =
              toAnalyze === 0
                ? `All ${cached} from cache`
                : cached > 0
                  ? `${cached} cached, analyzing ${toAnalyze} new`
                  : `Analyzing ${toAnalyze} emails`;
            setLoading((l) => ({ ...l, detail }));
          }
        );

        // Split into active/backlog
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const active: Todo[] = [];
        const old: Todo[] = [];

        const defaultList = reminderLists?.[0]?.list ?? "Work";
        const reminderStates = getEmailReminderStates(defaultList);

        for (const todo of result.todos) {
          const todoWithReminder = {
            ...todo,
            reminderState:
              reminderStates.get(todo.emailId ?? "") ??
              ("none" as ReminderState),
          };

          const todoDate = new Date(todo.date);
          if (todoDate < thirtyDaysAgo) {
            old.push(todoWithReminder);
          } else {
            active.push(todoWithReminder);
          }
        }

        if (reminderLists && reminderLists.length > 0) {
          const { todos: reminderTodos } = fetchPendingReminders(reminderLists);
          active.push(...reminderTodos);
        }

        setAllTodos(active);
        setAllBacklog(old);
        setLoading((l) => ({ ...l, active: false }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading((l) => ({ ...l, active: false }));
      }
    }

    init();
  }, [accounts.length]);

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
        client.star(todo.emailId).then(() => {
          updateTodoInList(todo.id, (t) => ({ ...t, isStarred: true }));
        });
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
