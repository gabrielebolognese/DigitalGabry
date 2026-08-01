/* The capture window writes to the same SQLite file the main window reads, and
   nothing in the main window's cache would otherwise know. */
export const BLOCKS_CHANGED = "digitalgabry://blocks-changed";
