# Notification Refactor: UI Focus-Aware

## Overview

Move notification logic from plugin (`stop` hook) to UI layer, triggering only when window is NOT focused.

## Current State

- `src/plugins/notification.ts` uses plugin `stop` hook
- Always plays notification when AI stops, regardless of window focus
- No awareness of UI focus state

## Design

### 1. NodeBridge Handler (`src/nodeBridge/slices/utils.ts`)

Add `utils.notify` handler:

```typescript
messageBus.registerHandler('utils.notify', async (data) => {
  const { cwd, config } = data;
  
  // Handle webhook URL
  if (typeof config === 'string' && /^https?:\/\//.test(config)) {
    const vars = { cwd, name: pathe.basename(cwd) };
    const url = replaceVars(config, vars);
    fetch(url).catch(() => {});
    return { success: true };
  }
  
  // Handle sound
  const { playSound, beep, SOUND_PRESETS } = await import('../../utils/sound');
  const soundName = typeof config === 'string' ? config : SOUND_PRESETS.warning;
  try {
    await playSound(soundName);
  } catch {
    beep();
  }
  return { success: true };
});
```

### 2. UI Effect Hook

Create `src/ui/useNotification.ts`:

```typescript
export function useNotification() {
  const status = useAppStore((s) => s.status);
  const approvalModal = useAppStore((s) => s.approvalModal);
  const isWindowFocused = useAppStore((s) => s.isWindowFocused);
  const bridge = useAppStore((s) => s.bridge);
  const cwd = useAppStore((s) => s.cwd);
  const prevStatusRef = useRef(status);
  const prevApprovalModalRef = useRef(approvalModal);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const prevApprovalModal = prevApprovalModalRef.current;
    prevStatusRef.current = status;
    prevApprovalModalRef.current = approvalModal;

    if (!bridge || !cwd) return;
    if (isWindowFocused) return;

    const wasProcessing =
      prevStatus === 'processing' ||
      prevStatus === 'planning' ||
      prevStatus === 'tool_executing' ||
      prevStatus === 'compacting';

    const isEnteringApproval = !prevApprovalModal && !!approvalModal;

    const shouldNotify =
      (wasProcessing && status === 'idle') || isEnteringApproval;

    if (shouldNotify) {
      bridge.request('config.get', { cwd, key: 'notification' }).then((res) => {
        const notificationConfig = res.data?.value;
        if (notificationConfig !== false) {
          bridge.request('utils.notify', { cwd, config: notificationConfig });
        }
      });
    }
  }, [status, approvalModal, isWindowFocused, bridge, cwd]);
}
```

Key points:
- Watch `status` and `approvalModal` changes in store
- Check `isWindowFocused` before notifying
- Trigger on task completion (transitioning from processing states to `idle`)
- Trigger on approval needed (when `approvalModal` becomes non-null)

### 3. Remove Plugin

Delete `src/plugins/notification.ts` since logic moves to UI layer.

## Data Flow

1. Status changes in store → Effect detects change
2. Check `isWindowFocused` state from store
3. If NOT focused → Call `utils.notify` via bridge
4. NodeBridge plays sound or sends webhook

## Files to Modify

1. `src/nodeBridge/slices/utils.ts` - Add `utils.notify` handler
2. `src/ui/App.tsx` or new `src/ui/useNotification.ts` - Add effect hook
3. `src/plugins/notification.ts` - Delete file
4. `src/plugin.ts` - Remove plugin registration (if needed)
