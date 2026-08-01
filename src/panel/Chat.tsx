import { useEffect, useRef } from "react";
import type { ChatMessage } from "./client";

type ChatProps = {
  messages: readonly ChatMessage[];
  streaming: string;
  error: string | null;
};

export default function Chat({ messages, streaming, error }: ChatProps) {
  const endRef = useRef<HTMLDivElement>(null);

  /* Pinned to the bottom as text arrives. Scrolling the container rather than
     animating anything keeps streaming from shifting the layout. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {messages.length === 0 && streaming === "" && (
        <span className="text-meta text-tertiary">Ask about your week</span>
      )}

      {messages.map((message, index) =>
        message.role === "user" ? (
          <div key={index} className="flex justify-end">
            <span className="max-w-full rounded-panel bg-elevated px-2 py-1 text-meta text-primary">
              {message.content}
            </span>
          </div>
        ) : (
          // Assistant turns carry no bubble. SPEC 9.
          <span key={index} className="whitespace-pre-wrap text-meta text-secondary">
            {message.content}
          </span>
        ),
      )}

      {streaming !== "" && (
        <span className="whitespace-pre-wrap text-meta text-secondary">{streaming}</span>
      )}

      {error !== null && <span className="text-meta text-cat-deadline">{error}</span>}

      <div ref={endRef} />
    </div>
  );
}
