/* Flat surface blocks standing in for content that has not arrived. Still, not
   pulsing: SPEC 3.5 caps every animation at 200ms, which rules out a shimmer,
   and PLAN phase 10 rules out a spinner. */

type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

type SkeletonListProps = {
  rows?: number;
  label: string;
  className?: string;
  rowClassName?: string;
};

export function SkeletonList({
  rows = 4,
  label,
  className = "flex flex-col gap-2",
  rowClassName = "h-4 w-full",
}: SkeletonListProps) {
  return (
    /* One live region for the whole group, and the blocks themselves hidden,
       so a screen reader hears "loading" once rather than counting boxes. */
    <div role="status" aria-label={label} className={className}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={rowClassName} />
      ))}
    </div>
  );
}
