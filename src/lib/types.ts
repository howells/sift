export type Urgency = "overdue" | "this_week" | "when_you_can";
export type ReminderState = "none" | "pending" | "completed";

export interface Todo {
	id: string;
	emailId: string;
	threadId: string;
	account: string;
	group: string;
	subject: string;
	from: string;
	fromEmail: string;
	summary: string;
	urgency: Urgency;
	reasoning: string;
	date: string;
	isStarred: boolean;
	person: string; // Name of person the task relates to
	deadline: string | null; // Formatted deadline (e.g., "Fri Jan 24") or null
	reminderState: ReminderState; // State of associated Apple Reminder
}

export interface AnalysisResult {
	todos: Todo[];
}

export type View = "main" | "backlog" | "search" | "command";

export interface AppState {
	view: View;
	todos: Todo[];
	backlog: Todo[];
	selectedIndex: number;
	selectedAccount: string | null; // null = all accounts
	isLoading: boolean;
	loadingMessage: string;
	error: string | null;
}
