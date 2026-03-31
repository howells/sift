/**
 * Format a date as a human-friendly relative string.
 * "2m ago", "3h ago", "yesterday", "3d ago", "2w ago", "Mar 15"
 */
export function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)}w ago`;
  }

  // Beyond a month, show the date
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format a deadline relative to today.
 * "today", "tomorrow", "in 3d", "in 2w", "overdue", or the formatted deadline string.
 */
export function relativeDeadline(deadline: string): string {
  if (deadline === "ASAP") {
    return "ASAP";
  }

  // Try to parse as a date-like string
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) {
    return deadline;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deadlineDay = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate()
  );
  const diffDays = Math.round(
    (deadlineDay.getTime() - today.getTime()) / 86_400_000
  );

  if (diffDays < 0) {
    return "overdue";
  }
  if (diffDays === 0) {
    return "today";
  }
  if (diffDays === 1) {
    return "tomorrow";
  }
  if (diffDays < 7) {
    return `in ${diffDays}d`;
  }
  if (diffDays < 30) {
    return `in ${Math.floor(diffDays / 7)}w`;
  }
  return deadline;
}
