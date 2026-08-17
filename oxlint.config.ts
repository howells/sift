import react from "@howells/lint/oxlint/react";

/**
 * Rules switched off to adopt the Oxlint/Oxfmt lane without rewriting a
 * working codebase in the same pass. Mirrors the `legacyCompatibilityRules`
 * block in @howells/ai. Everything here is stylistic or a strictness ratchet;
 * the real defect classes (no-floating-promises, await-thenable, unused
 * vars/dead stores) are left ON and were fixed in the source instead.
 *
 * sonarjs/no-os-command-from-path is off by design: sift shells out to `gog`
 * on PATH, which is the house pattern for these CLIs.
 */
const legacyCompatibilityRules = {
  "anti-slop/no-chained-type-assertions": "off",
  "anti-slop/no-conditional-empty-object-spread": "off",
  "anti-slop/no-known-value-widening": "off",
  "anti-slop/no-object-parameters": "off",
  "anti-slop/no-runtime-typeof": "off",
  "anti-slop/no-shape-in-symbol-names": "off",
  "anti-slop/no-unknown-parameters": "off",
  "anti-slop/no-unknown-returns": "off",
  "anti-slop/no-unsafe-dictionary-type": "off",
  "anti-slop/require-safety-comment-for-type-assertion": "off",
  complexity: "off",
  "default-case": "off",
  "func-style": "off",
  "github/no-then": "off",
  "howells/no-runtime-dynamic-imports": "off",
  "max-classes-per-file": "off",
  "max-lines": "off",
  "max-lines-per-function": "off",
  "no-await-in-loop": "off",
  "no-inline-comments": "off",
  "no-plusplus": "off",
  "no-restricted-properties": "off",
  "no-shadow": "off",
  "no-use-before-define": "off",
  "prefer-destructuring": "off",
  "prefer-named-capture-group": "off",
  "promise/avoid-new": "off",
  "promise/prefer-await-to-then": "off",
  "react-doctor/async-await-in-loop": "off",
  "react-doctor/js-set-map-lookups": "off",
  "react-doctor/js-tosorted-immutable": "off",
  "react-doctor/no-chain-state-updates": "off",
  "react-doctor/only-export-components": "off",
  "react-doctor/react-compiler-no-manual-memoization": "off",
  "react-doctor/rerender-state-only-in-handlers": "off",
  "react-doctor/server-sequential-independent-await": "off",
  "react/function-component-definition": "off",
  "react/no-unescaped-entities": "off",
  "react/react-compiler": "off",
  "require-unicode-regexp": "off",
  "sonarjs/cognitive-complexity": "off",
  "sonarjs/max-union-size": "off",
  "sonarjs/no-duplicate-string": "off",
  "sonarjs/no-nested-functions": "off",
  "sonarjs/no-os-command-from-path": "off",
  "sonarjs/no-undefined-assignment": "off",
  "sonarjs/todo-tag": "off",
  "sonarjs/too-many-break-or-continue-in-loop": "off",
  "sort-keys": "off",
  "typescript/consistent-return": "off",
  "typescript/no-base-to-string": "off",
  "typescript/no-deprecated": "off",
  "typescript/no-misused-promises": "off",
  "typescript/no-misused-spread": "off",
  "typescript/no-unnecessary-type-parameters": "off",
  "typescript/no-unsafe-argument": "off",
  "typescript/no-unsafe-assignment": "off",
  "typescript/no-unsafe-call": "off",
  "typescript/no-unsafe-member-access": "off",
  "typescript/no-unsafe-type-assertion": "off",
  "typescript/parameter-properties": "off",
  "typescript/prefer-nullish-coalescing": "off",
  "typescript/restrict-plus-operands": "off",
  "typescript/strict-boolean-expressions": "off",
  "typescript/strict-void-return": "off",
  "typescript/switch-exhaustiveness-check": "off",
  "unicorn/consistent-function-scoping": "off",
  "unicorn/custom-error-definition": "off",
  "unicorn/import-style": "off",
  "unicorn/no-array-sort": "off",
  "unicorn/prefer-code-point": "off",
  "unicorn/prefer-number-coercion": "off",
  "vitest/no-conditional-expect": "off",
  "vitest/require-top-level-describe": "off",
};

export default {
  extends: [react],
  ignorePatterns: ["dist/**", "node_modules/**"],
  rules: legacyCompatibilityRules,
  overrides: [
    {
      // The preset scopes its vitest rules to test files through its own
      // override, which a top-level `rules` entry cannot reach.
      files: ["**/*.test.ts", "**/*.test.tsx"],
      rules: legacyCompatibilityRules,
    },
  ],
};
