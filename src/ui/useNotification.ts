import { useEffect, useRef } from 'react';
import { useAppStore } from './store';

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
