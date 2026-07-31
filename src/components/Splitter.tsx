import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";

type SplitterProps = {
  onResize: (width: number) => void;
};

export default function Splitter({ onResize }: SplitterProps) {
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      onResize(window.innerWidth - event.clientX);
    },
    [onResize],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="shell-splitter group flex shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center"
    >
      <span
        className={[
          "motion-hover w-px",
          dragging ? "bg-line-strong" : "bg-hair group-hover:bg-line-strong",
        ].join(" ")}
      />
    </div>
  );
}
