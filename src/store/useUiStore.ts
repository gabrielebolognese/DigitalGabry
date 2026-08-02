import { useSyncExternalStore } from "react";

/* Selection is by entry, not by block. A recurring series shows many entries
   that all share one block id, and selecting "the block" would light up every
   instance of it and give the edit scope prompt no instant to act on. */
/* The week the calendar is showing lives in WeekView, and the palette can pick
   a block from any week. A request carries the instant to move to; the token
   makes a second request for the same entry a distinct value, so choosing the
   same result twice still moves the calendar back. */
export type RevealRequest = {
  entryId: string | null;
  startUtc: number;
  token: number;
};

export type UiState = {
  selectedEntryId: string | null;
  inspectorOpen: boolean;
  editingTitleEntryId: string | null;
  reveal: RevealRequest | null;
};

/* A module level store rather than context, so selection can be read from the
   calendar and the inspector without threading a provider through the shell.
   SPEC section 2 fixes the stack, and a state library is not in it. */
let state: UiState = {
  selectedEntryId: null,
  inspectorOpen: false,
  editingTitleEntryId: null,
  reveal: null,
};

let revealToken = 0;

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
    commit({
      ...state,
      selectedEntryId: entryId,
      inspectorOpen: true,
      editingTitleEntryId: null,
    });
  },

  /* Selects the entry and asks the calendar to bring its week into view. */
  revealEntry(entryId: string, startUtc: number): void {
    revealToken += 1;
    commit({
      selectedEntryId: entryId,
      inspectorOpen: true,
      editingTitleEntryId: null,
      reveal: { entryId, startUtc, token: revealToken },
    });
  },

  /* Moves the calendar without selecting anything, for "go to today". */
  revealInstant(startUtc: number): void {
    revealToken += 1;
    commit({ ...state, reveal: { entryId: null, startUtc, token: revealToken } });
  },

  clearSelection(): void {
    commit({
      ...state,
      selectedEntryId: null,
      inspectorOpen: false,
      editingTitleEntryId: null,
    });
  },

  closeInspector(): void {
    commit({ ...state, inspectorOpen: false, editingTitleEntryId: null });
  },

  startTitleEdit(entryId: string): void {
    commit({
      ...state,
      selectedEntryId: entryId,
      editingTitleEntryId: entryId,
    });
  },

  stopTitleEdit(): void {
    commit({ ...state, editingTitleEntryId: null });
  },
};
