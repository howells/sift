/**
 * Input validation for agent-provided values.
 * Agents hallucinate — reject anything that isn't a clean ID.
 */

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PATH_TRAVERSAL_PATTERN = /\.\./;
const QUERY_PARAM_PATTERN = /[?#%]/;

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string };

function hasControlChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function validateId(id: string): ValidationResult {
  if (!id || id.length === 0) {
    return { valid: false, error: "ID is required" };
  }

  if (id.length > 128) {
    return { valid: false, error: "ID too long (max 128 chars)" };
  }

  if (hasControlChars(id)) {
    return { valid: false, error: "ID contains control characters" };
  }

  if (PATH_TRAVERSAL_PATTERN.test(id)) {
    return { valid: false, error: "ID contains path traversal" };
  }

  if (QUERY_PARAM_PATTERN.test(id)) {
    return {
      valid: false,
      error: "ID contains query params or percent encoding",
    };
  }

  if (!VALID_ID_PATTERN.test(id)) {
    return {
      valid: false,
      error: "ID must be alphanumeric (with hyphens/underscores)",
    };
  }

  return { valid: true };
}

export function validateGroup(
  group: string,
  validGroups: string[]
): ValidationResult {
  if (!group) {
    return { valid: false, error: "Group is required" };
  }

  if (!validGroups.includes(group)) {
    return {
      valid: false,
      error: `Unknown group: "${group}". Valid groups: ${validGroups.join(", ")}`,
    };
  }

  return { valid: true };
}

export function validateFields(
  fields: string,
  validFields: string[]
): ValidationResult {
  const requested = fields.split(",").map((f) => f.trim());
  const invalid = requested.filter((f) => !validFields.includes(f));

  if (invalid.length > 0) {
    return {
      valid: false,
      error: `Unknown fields: ${invalid.join(", ")}. Valid: ${validFields.join(", ")}`,
    };
  }

  return { valid: true };
}
