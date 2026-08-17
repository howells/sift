/**
 * Input validation for agent-provided values.
 * Agents hallucinate — reject anything that isn't a clean ID.
 */

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const QUERY_PARAM_PATTERN = /[?#%]/;

export type ValidationResult = { valid: true } | { valid: false; error: string };

function hasControlChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Validate an ID is non-empty, alphanumeric, and free of traversal attacks. */
export function validateId(id: string): ValidationResult {
  if (!id || id.length === 0) {
    return { error: "ID is required", valid: false };
  }

  if (id.length > 128) {
    return { error: "ID too long (max 128 chars)", valid: false };
  }

  if (hasControlChars(id)) {
    return { error: "ID contains control characters", valid: false };
  }

  if (id.includes("..")) {
    return { error: "ID contains path traversal", valid: false };
  }

  if (QUERY_PARAM_PATTERN.test(id)) {
    return {
      error: "ID contains query params or percent encoding",
      valid: false,
    };
  }

  if (!VALID_ID_PATTERN.test(id)) {
    return {
      error: "ID must be alphanumeric (with hyphens/underscores)",
      valid: false,
    };
  }

  return { valid: true };
}

/** Validate that a group name exists in the configured groups list. */
export function validateGroup(group: string, validGroups: string[]): ValidationResult {
  if (!group) {
    return { error: "Group is required", valid: false };
  }

  if (!validGroups.includes(group)) {
    return {
      error: `Unknown group: "${group}". Valid groups: ${validGroups.join(", ")}`,
      valid: false,
    };
  }

  return { valid: true };
}

/** Validate that all comma-separated field names are in the allowed set. */
export function validateFields(fields: string, validFields: string[]): ValidationResult {
  const requested = fields.split(",").map((f) => f.trim());
  const invalid = requested.filter((f) => !validFields.includes(f));

  if (invalid.length > 0) {
    return {
      error: `Unknown fields: ${invalid.join(", ")}. Valid: ${validFields.join(", ")}`,
      valid: false,
    };
  }

  return { valid: true };
}
