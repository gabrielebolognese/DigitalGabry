import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { streamMessage } from "./client";

const SECTIONS = ["TODAY", "AT RISK", "MOMENTUM"] as const;

const SYSTEM = `You are a terse assistant inside a personal calendar and momentum tracker.
The user's current state is given as JSON. Reply with exactly three sections, each
introduced by its bare label on its own line, in this order:

TODAY
AT RISK
MOMENTUM

Under each label write at most two short sentences. No markdown, no bullet
characters, no headings beyond the three labels, no preamble. Sentence case.
If a section has nothing worth saying, write one short sentence saying so.`;

/* Cached with the launch, not with the component, so switching views and
   coming back does not spend another request. SPEC 9. */
let cache: { text: string; at: number } | null = null;

type SummaryProps = {
  apiKey: string;
  contextJson: string;
  ready: boolean;
};

function splitSections(text: string): Array<{ label: string; body: string }> {
  const found: Array<{ label: string; body: string }> = [];
  for (let index = 0; index < SECTIONS.length; index += 1) {
    const label = SECTIONS[index];
    const start = text.indexOf(label);
    if (start === -1) continue;
    const after = start + label.length;
    const nextLabel = SECTIONS.slice(index + 1)
      .map((candidate) => text.indexOf(candidate, after))
      .filter((position) => position !== -1)
      .sort((a, b) => a - b)[0];
    found.push({
      label,
      body: text.slice(after, nextLabel ?? text.length).trim(),
    });
  }
  return found;
}

export default function Summary({ apiKey, contextJson, ready }: SummaryProps) {
  const [text, setText] = useState(cache?.text ?? "");
  const [at, setAt] = useState<number | null>(cache?.at ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let collected = "";
    try {
      await streamMessage({
        apiKey,
        system: SYSTEM,
        messages: [{ role: "user", content: contextJson }],
        maxTokens: 512,
        onText: (delta) => {
          collected += delta;
          setText(collected);
        },
      });
      cache = { text: collected, at: Date.now() };
      setAt(cache.at);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the API");
    } finally {
      setBusy(false);
    }
  }, [apiKey, contextJson, busy]);

  /* Once per app launch, then only on demand. */
  useEffect(() => {
    if (!ready || cache !== null) return;
    void generate();
    // generate is intentionally not a dependency: this fires once, and adding
    // it would re-run whenever the context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const sections = splitSections(text);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <span className="text-micro uppercase text-tertiary">Summary</span>
        <div className="flex-1" />
        {at !== null && (
          <span className="text-micro text-disabled">
            {new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <button
          type="button"
          aria-label="Regenerate summary"
          disabled={busy || !ready}
          onClick={() => void generate()}
          className="motion-hover flex rounded-control p-1 text-tertiary hover:bg-hover hover:text-primary"
        >
          <RotateCcw className="icon-content" aria-hidden={true} />
        </button>
      </div>

      {error !== null && <span className="text-meta text-cat-deadline">{error}</span>}

      {text === "" && !busy && error === null && (
        <span className="text-meta text-tertiary">Nothing summarised yet</span>
      )}

      {sections.length > 0
        ? sections.map((section) => (
            <div key={section.label} className="flex flex-col gap-1">
              <span className="text-micro uppercase text-tertiary">{section.label}</span>
              <span className="text-prose text-meta text-secondary">{section.body}</span>
            </div>
          ))
        : text !== "" && <span className="text-prose text-meta text-secondary">{text}</span>}
    </div>
  );
}
