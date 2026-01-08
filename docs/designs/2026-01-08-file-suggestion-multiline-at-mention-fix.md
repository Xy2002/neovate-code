# File Suggestion Multiline @ Mention Fix

**Date:** 2026-01-08

## Context

When using the `@` character to trigger file suggestions in the chat input, the feature works correctly on a single line. However, when there is already an `@` mention on the first line and the user types `@` at the start of the second line, the file suggestion does not trigger.

## Discussion

The root cause was identified in the `useAtTriggeredPaths` function in `src/ui/useFileSuggestion.ts`. The regex pattern used to match `@` mentions was:

```js
/(?:^|\s)(@(?:"[^"]*"|(?:[^\\ ]|\\ )*))/g
```

The issue is that `[^\\ ]` (non-space, non-backslash characters) includes newlines. This causes multi-line input like `@foo\n@` to be captured as a **single match** rather than two separate `@` mentions.

A question was raised about whether quoted paths (like `@"path with spaces"`) should be allowed to span multiple lines. The decision was made that quoted paths should also terminate at newlines, keeping each `@` mention scoped to a single line.

## Approach

Update the regex pattern to exclude newlines from both quoted and unquoted path matching:

1. Change `[^"]*` to `[^"\n]*` — quoted paths terminate at newline
2. Change `[^\\ ]` to `[^\s\\]` — unquoted paths exclude all whitespace (space, tab, newline), not just space

This ensures each line's `@` mention is treated independently.

## Architecture

**File Changed:** `src/ui/useFileSuggestion.ts`

**Before:**
```js
/(?:^|\s)(@(?:"[^"]*"|(?:[^\\ ]|\\ )*))/g
```

**After:**
```js
/(?:^|\s)(@(?:"[^"\n]*"|(?:[^\s\\]|\\ )*))/g
```

**Verification:**
```js
const value = '@foo\n@';
// Before: 1 match: ["@foo\n@", "@foo\n@"]
// After:  2 matches: ["@foo", "@foo"], ["\n@", "@"]
```

The fix correctly identifies two separate `@` mentions, allowing file suggestions to trigger independently on each line.
