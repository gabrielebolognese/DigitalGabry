import { useEffect } from "react";

const AUTO_DISMISS_MS = 5000;

export type ToastAction = {
  label: string;
  onAct: () => void;
};

type ToastProps = {
  message: string;
  action?: ToastAction;
  onDismiss: () => void;
};

export default function Toast({ message, action, onDismiss }: ToastProps) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [onDismiss, message]);

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-panel border border-line bg-elevated px-3 py-2"
    >
      <span className="text-meta text-primary">{message}</span>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onAct}
          className="motion-hover rounded-control px-2 py-1 text-meta text-accent hover:bg-hover"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
