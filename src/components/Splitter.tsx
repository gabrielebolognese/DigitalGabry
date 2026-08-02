import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type SplitterProps = {
  onResize: (width: number) => void;
};

const STEP = 8;
const COARSE_STEP = 32;

export default function Splitter({ onResize }: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* Measured from the panel itself rather than tracked in state, so the number
     reported here is the clamped width actually on screen. The range stays in
     tokens.css and nothing has to duplicate it. */
  const measure = useCallback((): number => {
    const panel = rootRef.current?.nextElementSibling;
    return panel instanceof HTMLElement ? panel.getBoundingClientRect().width : 0;
  }, []);

  useEffect(() => {
    setWidth(measure());
  }, [measure]);

  const resizeTo = useCallback(
    (next: number) => {
      onResize(next);
      // The clamp is in CSS, so the applied width is only known after paint.
      requestAnimationFrame(() => setWidth(measure()));
    },
    [measure, onResize],
  );

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      resizeTo(window.innerWidth - event.clientX);
    },
    [resizeTo],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

  /* The panel sits on the right, so left widens it and right narrows it. */
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? COARSE_STEP : STEP;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        resizeTo(measure() + step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        resizeTo(measure() - step);
      }
    },
    [measure, resizeTo],
  );

  return (
    <div
      ref={rootRef}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={Math.round(width)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      className="shell-splitter group flex shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center rounded-block"
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
