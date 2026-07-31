import { Calendar, Settings, TrendingUp, type LucideIcon } from "lucide-react";

export type ViewId = "calendar" | "momentum" | "settings";

export const VIEW_LABELS: Record<ViewId, string> = {
  calendar: "Calendar",
  momentum: "Momentum",
  settings: "Settings",
};

type RailItem = {
  id: ViewId;
  icon: LucideIcon;
};

const PRIMARY_ITEMS: readonly RailItem[] = [
  { id: "calendar", icon: Calendar },
  { id: "momentum", icon: TrendingUp },
];

const SETTINGS_ITEM: RailItem = { id: "settings", icon: Settings };

type RailButtonProps = {
  item: RailItem;
  active: boolean;
  onSelect: (id: ViewId) => void;
};

function RailButton({ item, active, onSelect }: RailButtonProps) {
  const label = VIEW_LABELS[item.id];
  const Icon = item.icon;

  return (
    <div className="tooltip-host relative flex justify-center">
      <button
        type="button"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(item.id)}
        className={[
          "shell-rail-item motion-hover flex items-center justify-center rounded-control border",
          active
            ? "border-line bg-selected text-primary"
            : "border-transparent text-tertiary hover:bg-hover hover:text-secondary",
        ].join(" ")}
      >
        <Icon className="icon-rail" aria-hidden="true" />
      </button>
      <span
        aria-hidden="true"
        className="tooltip pointer-events-none absolute top-1/2 left-full z-10 -translate-y-1/2 rounded-control border border-line bg-elevated px-2 py-1 text-meta whitespace-nowrap text-secondary"
      >
        {label}
      </span>
    </div>
  );
}

type RailProps = {
  view: ViewId;
  onViewChange: (id: ViewId) => void;
};

export default function Rail({ view, onViewChange }: RailProps) {
  return (
    <nav
      aria-label="Views"
      className="shell-rail flex shrink-0 flex-col items-center gap-1 border-r border-hair bg-rail py-2"
    >
      <div
        aria-hidden="true"
        className="shell-avatar mb-2 flex shrink-0 items-center justify-center rounded-control bg-accent text-meta font-medium text-primary"
      >
        G
      </div>

      {PRIMARY_ITEMS.map((item) => (
        <RailButton
          key={item.id}
          item={item}
          active={view === item.id}
          onSelect={onViewChange}
        />
      ))}

      <div className="flex-1" />

      <RailButton
        item={SETTINGS_ITEM}
        active={view === SETTINGS_ITEM.id}
        onSelect={onViewChange}
      />
    </nav>
  );
}
