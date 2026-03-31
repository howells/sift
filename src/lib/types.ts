export type Urgency = "overdue" | "this_week" | "when_you_can";
export type ReminderState = "none" | "pending" | "completed";
export type TodoSource = "email" | "reminder";

export interface Todo {
  account: string;
  date: string;
  deadline: string | null; // Formatted deadline (e.g., "Fri Jan 24") or null
  emailId?: string; // Only for email-sourced todos
  from: string;
  fromEmail: string;
  group: string;
  id: string;
  isStarred: boolean;
  person: string; // Name of person the task relates to
  reasoning: string;
  reminderId?: string; // Only for reminder-sourced todos
  reminderState: ReminderState; // State of associated Apple Reminder
  source: TodoSource;
  subject: string;
  summary: string;
  threadId?: string; // Only for email-sourced todos
  urgency: Urgency;
}

export interface AnalysisResult {
  todos: Todo[];
}

export type View = "main" | "backlog" | "search" | "command";
