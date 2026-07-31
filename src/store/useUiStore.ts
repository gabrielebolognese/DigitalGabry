import { useSyncExternalStore } from "react";

export type UiState = {
  selectedBlockId: string | null;
  inspectorOpen: boolean;
  editingTitleBlockId: string | null;
};

/* A module level store rather than context, so selection can be read from the
   calendar and the inspector without threading a provider through the shell.
   SPEC section 2 fixes the stack, and a state library is not in it. */
let state: UiState = {
  selectedBlockId: null,
  inspectorOpen: false,
  editingTitleBlockId: null,
};

const listeners = new Set<() => void>();

function commit(next: UiState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): UiState {
  return state;
}

export function useUiStore(): UiState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export const ui = {
  selectBlock(id: string): void {
    commit({ selectedBlockId: id, inspectorOpen: true, editingTitleBlockId: null });
  },

  clearSelection(): void {
    commit({ selectedBlockId: null, inspectorOpen: false, editingTitleBlockId: null });
  },

  closeInspector(): void {
    commit({ ...state, inspectorOpen: false, editingTitleBlockId: null });
  },

  startTitleEdit(id: string): void {
    commit({ selectedBlockId: id, inspectorOpen: state.inspectorOpen, editingTitleBlockId: id });
  },

  stopTitleEdit(): void {
    commit({ ...state, editingTitleBlockId: null });
  },
};
