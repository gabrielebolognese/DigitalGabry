import { useSyncExternalStore } from "react";

/* Selection is by entry, not by block. A recurring series shows many entries
   that all share one block id, and selecting "the block" would light up every
   instance of it and give the edit scope prompt no instant to act on. */
export type UiState = {
  selectedEntryId: string | null;
  inspectorOpen: boolean;
  editingTitleEntryId: string | null;
};

/* A module level store rather than context, so selection can be read from the
   calendar and the inspector without threading a provider through the shell.
   SPEC section 2 fixes the stack, and a state library is not in it. */
let state: UiState = {
  selectedEntryId: null,
  inspectorOpen: false,
  editingTitleEntryId: null,
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
  selectEntry(entryId: string): void {
    commit({ selectedEntryId: entryId, inspectorOpen: true, editingTitleEntryId: null });
  },

  clearSelection(): void {
    commit({ selectedEntryId: null, inspectorOpen: false, editingTitleEntryId: null });
  },

  closeInspector(): void {
    commit({ ...state, inspectorOpen: false, editingTitleEntryId: null });
  },

  startTitleEdit(entryId: string): void {
    commit({
      selectedEntryId: entryId,
      inspectorOpen: state.inspectorOpen,
      editingTitleEntryId: entryId,
    });
  },

  stopTitleEdit(): void {
    commit({ ...state, editingTitleEntryId: null });
  },
};
