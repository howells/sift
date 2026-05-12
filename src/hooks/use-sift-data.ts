import open from "open";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadSiftData, runTodoAction, selectTodos } from "../lib/actions.ts";
import type { SiftData } from "../lib/pipeline.ts";
import { openRemindersApp } from "../lib/reminders.ts";
import type { Todo, View } from "../lib/types.ts";

interface LoadingState {
	active: boolean;
	detail?: string;
	message: string;
	step: number;
}

export interface SiftState {
	accountGroups: string[];
	backlog: Todo[];
	backlogCount: number;
	createReminder: () => void;
	currentList: Todo[];
	dismissBacklog: () => void;
	error: string | null;
	loading: LoadingState;

	// Actions
	markDone: () => void;
	moveDown: () => void;

	// Navigation
	moveUp: () => void;
	openTodo: () => void;
	refresh: () => void;
	selectedGroup: string | null;
	selectedIndex: number;
	starTodo: () => void;
	// Data
	todos: Todo[];
	toggleBacklog: () => void;
	toggleGroup: (groupIndex: number) => void;

	// View state
	view: View;
}

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
	const [siftData, setSiftData] = useState<SiftData | null>(null);
	const [refreshTrigger, setRefreshTrigger] = useState(0);
	const autoRefreshQueued = useRef(false);
	const [accountGroups, setAccountGroups] = useState<string[]>([]);

	// --- Data loading ---

	useEffect(() => {
		if (refreshTrigger > 0) {
			setLoading({
				active: true,
				message: "Refreshing...",
				step: 1,
			});
		}

		async function init() {
			try {
				const data = await loadSiftData((step, message, detail) => {
					setLoading({ active: true, detail, message, step });
				});

				setSiftData(data);
				setAccountGroups(data.groups);
				setAllTodos(data.active);
				setAllBacklog(data.backlog);
				setLoading((l) => ({ ...l, active: false }));
			} catch (err) {
				setError(err instanceof Error ? err.message : "Unknown error");
				setLoading((l) => ({ ...l, active: false }));
			}
		}

		init();
	}, [refreshTrigger]);

	// --- Filtered/sorted lists ---

	const filteredTodos = useMemo(
		() =>
			selectTodos(
				{
					accounts: [],
					active: allTodos,
					backlog: allBacklog,
					clients: new Map(),
					groups: accountGroups,
				},
				{ group: selectedGroup ?? undefined, view: "active" },
			),
		[accountGroups, allBacklog, allTodos, selectedGroup],
	);

	const filteredBacklog = useMemo(
		() =>
			selectTodos(
				{
					accounts: [],
					active: allTodos,
					backlog: allBacklog,
					clients: new Map(),
					groups: accountGroups,
				},
				{ group: selectedGroup ?? undefined, view: "backlog" },
			),
		[accountGroups, allBacklog, allTodos, selectedGroup],
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

	// --- Navigation ---

	function moveUp() {
		setSelectedIndex((i) => Math.max(0, i - 1));
	}

	function moveDown() {
		setSelectedIndex((i) =>
			Math.min(Math.max(0, currentList.length - 1), i + 1),
		);
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
			if (!group) {
				return;
			}

			setSelectedGroup((current) => (current === group ? null : group));
			setSelectedIndex(0);
		}
	}

	// --- Todo actions ---

	function markDone() {
		const todo = currentList[selectedIndex];
		if (!(todo && siftData)) {
			return;
		}

		const newLength = currentList.filter((t) => t.id !== todo.id).length;
		Promise.resolve(runTodoAction("done", todo, siftData)).then((result) => {
			if (!result.success) {
				return;
			}
			removeTodoFromList(todo.id);
			setSelectedIndex((i) => Math.min(i, Math.max(0, newLength - 1)));
		});
	}

	function starTodo() {
		const todo = currentList[selectedIndex];
		if (!(todo && siftData) || todo.source === "reminder") {
			return;
		}

		if (!todo.isStarred) {
			Promise.resolve(runTodoAction("star", todo, siftData)).then((result) => {
				if (result.success) {
					updateTodoInList(todo.id, (t) => ({ ...t, isStarred: true }));
				}
			});
		}
	}

	function createReminderAction() {
		const todo = currentList[selectedIndex];
		if (
			!(todo && siftData) ||
			todo.source === "reminder" ||
			todo.reminderState !== "none"
		) {
			return;
		}

		Promise.resolve(runTodoAction("remind", todo, siftData)).then((result) => {
			if (result.success) {
				updateTodoInList(todo.id, (t) => ({
					...t,
					reminderState: "pending",
				}));
			}
		});
	}

	function openTodo() {
		const todo = currentList[selectedIndex];
		if (!(todo && siftData)) {
			return;
		}

		if (todo.source === "reminder") {
			openRemindersApp();
			return;
		}

		Promise.resolve(runTodoAction("open", todo, siftData)).then((result) => {
			if (result.success && result.error) {
				open(result.error);
			}
		});
	}

	function refresh() {
		setLoading({ active: true, message: "Connecting to Gmail", step: 1 });
		setAllTodos([]);
		setAllBacklog([]);
		setSiftData(null);
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
