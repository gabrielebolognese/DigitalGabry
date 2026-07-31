import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Rail, { VIEW_LABELS, type ViewId } from "./Rail";
import Splitter from "./Splitter";

const PANEL_WIDTH_KEY = "digitalgabry.panel-width";

function readStoredPanelWidth(): number | null {
  const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
  if (raw === null) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

type AppShellProps = {
  view: ViewId;
  onViewChange: (id: ViewId) => void;
};

export default function AppShell({ view, onViewChange }: AppShellProps) {
  const [panelWidth, setPanelWidth] = useState<number | null>(readStoredPanelWidth);
  const [panelOpen, setPanelOpen] = useState(true);

  const handleResize = useCallback((width: number) => {
    setPanelWidth(width);
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)));
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "." && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setPanelOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // React's CSSProperties carries no index signature, so a custom property
  // needs the cast to reach the style attribute.
  const panelStyle =
    panelWidth === null
      ? undefined
      : ({ "--panel-w": `${panelWidth}px` } as CSSProperties);

  return (
    <div className="flex h-full w-full overflow-hidden bg-app text-primary">
      <Rail view={view} onViewChange={onViewChange} />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shell-header shrink-0 border-b border-hair" />
        <div className="flex flex-1 items-center justify-center">
          <span className="text-title text-tertiary">{VIEW_LABELS[view]}</span>
        </div>
      </main>

      {panelOpen && (
        <div className="flex max-panel:hidden">
          <Splitter onResize={handleResize} />
          <aside
            aria-label="AI panel"
            className="shell-panel flex shrink-0 flex-col"
            style={panelStyle}
          >
            <header className="shell-header shrink-0 border-b border-hair" />
            <div className="flex flex-1 items-center justify-center">
              <span className="text-title text-tertiary">AI panel</span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
