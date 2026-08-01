/* The capture window writes to the same SQLite file the main window reads, and
   nothing in the main window's cache would otherwise know. */
export const BLOCKS_CHANGED = "digitalgabry://blocks-changed";

/* Settings writes the key, the panel reads it. Without this the panel keeps
   showing its empty state until the window is reopened. */
export const API_KEY_CHANGED = "digitalgabry://api-key-changed";
