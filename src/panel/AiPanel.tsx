import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronLeft } from "lucide-react";
import { DEFAULT_TZ, weekRange } from "../domain/time";
import { useBlocks } from "../store/useBlocks";
import { useMomentum } from "../store/useMomentum";
import { API_KEY_CHANGED } from "../store/events";
import { readApiKey } from "./apiKey";
import { serialiseContext } from "./context";
import { streamMessage, type ChatMessage } from "./client";
import Chat from "./Chat";
import Summary from "./Summary";

const SYSTEM = `You are a terse assistant inside a personal calendar and momentum tracker.
The user's current state is given as JSON in the first message. Answer in plain
sentences, sentence case, no markdown and no bullet characters. Be brief.`;

type AiPanelProps = {
  tz?: string;
};

export default function AiPanel({ tz = DEFAULT_TZ }: AiPanelProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [checkedKey, setCheckedKey] = useState(false);
  const [mode, setMode] = useState<"summary" | "chat">("summary");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshKey = useCallback(() => {
    void readApiKey().then((key) => {
      setApiKey(key);
      setCheckedKey(true);
    });
  }, []);

  useEffect(() => {
    refreshKey();
    let unlisten: (() => void) | null = null;
    void listen(API_KEY_CHANGED, refreshKey).then((stop) => {
      unlisten = stop;
    });
    return () => {
      if (unlisten !== null) unlisten();
    };
  }, [refreshKey]);

  const [anchorUtc] = useState(() => Date.now());
  const range = useMemo(() => weekRange(anchorUtc, tz), [anchorUtc, tz]);
  const { blocks } = useBlocks(range, tz);
  const momentum = useMomentum(tz);

  const context = useMemo(
    () =>
      serialiseContext({
        entries: blocks,
        momentum: momentum.series,
        range,
        nowUtc: Date.now(),
        tz,
      }),
    [blocks, momentum.series, range, tz],
  );

  const ready = apiKey !== null && !momentum.loading;

  const send = useCallback(async () => {
    const question = draft.trim();
    if (question === "" || apiKey === null || busy) return;

    setDraft("");
    setError(null);
    setBusy(true);
    setMode("chat");

    // The context rides in as the first user turn, so the whole conversation
    // stays inside one bounded payload rather than growing a system prompt.
    const history: ChatMessage[] = [
      ...(messages.length === 0
        ? [{ role: "user" as const, content: context.json }]
        : []),
      ...messages,
      { role: "user" as const, content: question },
    ];
    setMessages(history);

    let collected = "";
    try {
      await streamMessage({
        apiKey,
        system: SYSTEM,
        messages: history,
        onText: (delta) => {
          collected += delta;
          setStreaming(collected);
        },
      });
      setMessages([...history, { role: "assistant", content: collected }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the API");
    } finally {
      setStreaming("");
      setBusy(false);
    }
  }, [draft, apiKey, busy, messages, context.json]);

  return (
    <>
      <header className="shell-header flex shrink-0 items-center gap-1 border-b border-hair px-3">
        {mode === "chat" && (
          <button
            type="button"
            aria-label="Back to summary"
            onClick={() => setMode("summary")}
            className="motion-hover flex rounded-control p-1 text-tertiary hover:bg-hover hover:text-primary"
          >
            <ChevronLeft className="icon-content" aria-hidden={true} />
          </button>
        )}
        <span className="text-title text-primary">
          {mode === "chat" ? "Chat" : "Assistant"}
        </span>
      </header>

      {!checkedKey ? (
        <div className="flex min-h-0 flex-1" />
      ) : apiKey === null ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <span className="text-meta text-tertiary">
            Add an Anthropic API key in Settings to use the assistant
          </span>
          <span className="text-micro text-disabled">
            Everything else works without one
          </span>
        </div>
      ) : mode === "summary" ? (
        <Summary apiKey={apiKey} contextJson={context.json} ready={ready} />
      ) : (
        <Chat messages={messages} streaming={streaming} error={error} />
      )}

      <div className="shell-panel-input flex shrink-0 items-center border-t border-hair px-2">
        <input
          value={draft}
          disabled={apiKey === null}
          placeholder={apiKey === null ? "Add a key in Settings" : "Ask anything"}
          aria-label="Ask the assistant"
          onChange={(event) => {
            setDraft(event.target.value);
            // Typing is what moves the panel from summary to chat. SPEC 9.
            if (event.target.value !== "" && mode === "summary") setMode("chat");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
          className="w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary"
        />
      </div>
    </>
  );
}
