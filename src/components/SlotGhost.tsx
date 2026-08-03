import { Plus } from "lucide-react";
import { iconForKindAndPlatform } from "./blockIcon";
import type { Slot } from "../domain/generation/types";

/* Spec1.1 12.1. A virtual slot renders as a ghost: subordinate to a real block
   in every way, because an empty 18:00 Monday slot is not something you owe
   anyone. It is a container waiting for content, and drawing it like a
   commitment makes every unfilled one look like a missed obligation. */

type SlotGhostProps = {
  slot: Slot;
  label: string;
  onAssign: (slot: Slot) => void;
  onExplain: (slot: Slot, anchor: HTMLElement) => void;
};

export default function SlotGhost({ slot, label, onAssign, onExplain }: SlotGhostProps) {
  const Icon = iconForKindAndPlatform(slot.intent.kind, slot.intent.platform);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Empty ${label} slot`}
      data-slot-key={slot.key}
      onClick={() => onAssign(slot)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onAssign(slot);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onExplain(slot, event.currentTarget);
      }}
      className="slot-ghost group motion-hover flex h-full w-full min-w-0 cursor-default items-start gap-1 overflow-hidden px-1 py-1"
    >
      <Icon className="icon-content shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-micro text-tertiary">{label}</span>

      {/* Hover reveals the affordances rather than carrying them always, which
          is what keeps a week of empty slots quiet. */}
      <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
        <Plus className="icon-content text-secondary" aria-hidden />
      </span>
    </div>
  );
}
