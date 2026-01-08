# Slash Command Input Preservation on Terminal Resize

**Date:** 2026-01-08

## Context

Slash commands with interactive input (like `/bug`, `/login`, `/model`) were losing user-entered data when the terminal window was resized. Users would type content into a TextInput field, resize their terminal, and find their input had been cleared.

## Discussion

Investigation revealed the issue was not in individual slash command components or the TextInput component itself. The root cause was in `App.tsx`:

```tsx
<Box
  flexDirection="column"
  key={`${forceRerender}-${forkParentUuid}-${forkCounter}-${transcriptMode}`}
>
  ...
  <SlashCommandJSX />
  ...
</Box>
```

The `useTerminalRefresh` hook increments `forceRerender` when terminal dimensions change significantly. Since this value is part of the `key` prop on the parent `Box`, React treats this as a completely new component tree and unmounts/remounts all children - including `SlashCommandJSX` and any active slash command components.

Three solutions were considered:

1. **Remove forceRerender from key** - Could break intentional re-render behavior for other components
2. **Persist state externally** - Would require refactoring all slash commands to use Zustand instead of local state
3. **Move SlashCommandJSX outside keyed Box** - Minimal change, preserves existing behavior for other components

## Approach

Option C was selected: Move `<SlashCommandJSX />` outside the keyed `Box` container. This ensures terminal resize triggers re-renders for components that need it (Messages, ChatInput, etc.) while preserving slash command component instances and their state.

## Architecture

The fix is a simple structural change in `App.tsx`:

**Before:**
```tsx
<TerminalSizeProvider>
  <Box flexDirection="column" key={`${forceRerender}-...`}>
    ...
    <SlashCommandJSX />
    ...
  </Box>
</TerminalSizeProvider>
```

**After:**
```tsx
<TerminalSizeProvider>
  <Box flexDirection="column" key={`${forceRerender}-...`}>
    ...
  </Box>
  <SlashCommandJSX />
</TerminalSizeProvider>
```

`SlashCommandJSX` remains inside `TerminalSizeProvider` so it can still access terminal dimensions via `useTerminalSize()` for responsive layouts, but its lifecycle is no longer tied to the `forceRerender` counter.
