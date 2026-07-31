import { MINUTES_PER_HOUR, localMinutesOfDay } from "../../domain/time";

type NowLineProps = {
  nowUtc: number;
  tz: string;
};

export default function NowLine({ nowUtc, tz }: NowLineProps) {
  const minutes = localMinutesOfDay(nowUtc, tz);

  return (
    <div
      aria-hidden="true"
      className="now-line pointer-events-none absolute inset-x-0 z-10"
      style={{ top: `calc(var(--hour-h) * ${minutes / MINUTES_PER_HOUR})` }}
    >
      <span className="now-dot absolute left-0 top-1/2" />
    </div>
  );
}
