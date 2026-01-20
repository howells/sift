export type Urgency = "overdue" | "this_week" | "when_you_can";

export interface Todo {
  id: string;
  emailId: string;
  threadId: string;
  account: string;
  group: "personal" | "siteinspire";
  subject: string;
  from: string;
  fromEmail: string;
  summary: string;
  urgency: Urgency;
  reasoning: string;
  date: string;
  isStarred: boolean;
  person: string;           // Name of person the task relates to
  deadline: string | null;  // Formatted deadline (e.g., "Fri Jan 24") or null
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
