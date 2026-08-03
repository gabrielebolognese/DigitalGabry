import { STATUS_LABELS, STATUS_TONES, type ContentStatus } from "../domain/content";

/* Spec2 1.3. The chip is padded 4 by 8 rather than the 2 by 6 the document
   quotes: SPEC 3.4 and invariant 3 put every padding on the 4px grid, and the
   same conflict was resolved this way in phase 10. */

const TONE_CLASS: Record<string, string> = {
  content: "bg-cat-content-weak text-cat-content",
  build: "bg-cat-build-weak text-cat-build",
  admin: "bg-cat-admin-weak text-cat-admin",
  personal: "bg-cat-personal-weak text-cat-personal",
  disabled: "text-disabled",
};

export default function StatusChip({ status }: { status: ContentStatus }) {
  return (
    <span
      className={`shrink-0 rounded-block px-2 py-1 text-micro uppercase ${
        TONE_CLASS[STATUS_TONES[status]] ?? TONE_CLASS["disabled"]
      }`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
