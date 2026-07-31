import { HOURS_PER_DAY, formatHourLabel } from "../../domain/time";

export default function TimeGutter() {
  return (
    <div className="cal-gutter cal-body relative shrink-0">
      {Array.from({ length: HOURS_PER_DAY }, (_, hour) => hour)
        .filter((hour) => hour > 0)
        .map((hour) => (
          <span
            key={hour}
            className="absolute right-1 -translate-y-1/2 text-micro text-tertiary"
            style={{ top: `calc(var(--hour-h) * ${hour})` }}
          >
            {formatHourLabel(hour)}
          </span>
        ))}
    </div>
  );
}
