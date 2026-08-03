import { Eye, EyeOff, Layers } from "lucide-react";
import { describeGenerator } from "../domain/generation/registry";
import type { SlotsApi } from "../store/useSlots";

/* Spec1.1 12.2. Display only: toggling a layer changes what is drawn and never
   what is generated. The master toggle matters more than it looks, because a
   schedule is noise on the days you are not following it, and being able to
   get back to a plain calendar in one click is what makes it safe to leave the
   rules switched on. */

type LayersPopoverProps = {
  api: SlotsApi;
  open: boolean;
  onToggle: () => void;
};

export default function LayersPopover({ api, open, onToggle }: LayersPopoverProps) {
  const generators = api.ruleset?.generators ?? [];

  /* One row per generator, not per version: a family of versions is one layer
     as far as the eye is concerned. */
  const families = new Map<string, (typeof generators)[number]>();
  for (const generator of generators) {
    const current = families.get(generator.id);
    if (current === undefined || generator.version > current.version) {
      families.set(generator.id, generator);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Layers"
        aria-expanded={open}
        onClick={onToggle}
        className={`motion-hover flex rounded-control p-1 hover:bg-hover ${
          api.allHidden ? "text-accent" : "text-tertiary hover:text-primary"
        }`}
      >
        <Layers className="icon-content" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Layers"
          className="absolute right-0 top-full z-40 mt-1 flex w-72 flex-col gap-1 rounded-panel border border-line bg-elevated p-2"
        >
          <button
            type="button"
            onClick={api.allHidden ? api.showAll : api.hideAll}
            className="motion-hover flex items-center gap-2 rounded-control px-2 py-1 text-meta text-primary hover:bg-hover"
          >
            {api.allHidden ? (
              <EyeOff className="icon-content shrink-0" aria-hidden />
            ) : (
              <Eye className="icon-content shrink-0" aria-hidden />
            )}
            {api.allHidden ? "Show all slots" : "Hide all slots"}
          </button>

          {families.size === 0 ? (
            <span className="px-2 py-1 text-meta text-tertiary">
              No schedule rules yet
            </span>
          ) : (
            <div className="flex flex-col gap-1 border-t border-hair pt-1">
              {[...families.values()].map((generator) => {
                const isHidden = api.hidden.has(generator.id);
                return (
                  <button
                    key={generator.id}
                    type="button"
                    aria-pressed={!isHidden}
                    onClick={() => api.toggleHidden(generator.id)}
                    className="motion-hover flex items-center gap-2 rounded-control px-2 py-1 text-left hover:bg-hover"
                  >
                    {isHidden ? (
                      <EyeOff className="icon-content shrink-0 text-disabled" aria-hidden />
                    ) : (
                      <Eye className="icon-content shrink-0 text-secondary" aria-hidden />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={`truncate text-meta ${isHidden ? "text-disabled" : "text-primary"}`}
                      >
                        {generator.name}
                      </span>
                      <span className="truncate text-micro text-tertiary">
                        {describeGenerator(generator)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
