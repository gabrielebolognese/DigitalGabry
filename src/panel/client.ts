/* Hand written against the Messages API rather than the SDK, because SPEC 2
   fixes the stack and the SDK is not in it. One endpoint, text in, text out. */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/* SPEC 9. */
export const MODEL = "claude-sonnet-4-6";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type StreamOptions = {
  apiKey: string;
  system: string;
  messages: readonly ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  onText: (delta: string) => void;
};

/* One line, no exception text, and never anything derived from the key.
   SPEC 3.7: say what happened and what to do, no "Error:" prefix. */
function messageForStatus(status: number): string {
  if (status === 401) return "The API key was rejected, check it in Settings";
  if (status === 403) return "That key does not have access to this model";
  if (status === 404) return "The model is unavailable, check Settings";
  if (status === 429) return "Rate limited by the API, try again shortly";
  if (status === 413) return "That was too much context to send";
  if (status >= 500) return "The API is having trouble, try again shortly";
  return "The request was refused by the API";
}

function parseSse(chunk: string, onText: (delta: string) => void): void {
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") continue;

    try {
      const event: unknown = JSON.parse(payload);
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type: unknown }).type === "content_block_delta" &&
        "delta" in event
      ) {
        const delta = (event as { delta: unknown }).delta;
        if (
          typeof delta === "object" &&
          delta !== null &&
          "type" in delta &&
          (delta as { type: unknown }).type === "text_delta" &&
          "text" in delta
        ) {
          const text = (delta as { text: unknown }).text;
          if (typeof text === "string") onText(text);
        }
      }
    } catch {
      // A malformed frame is not worth failing the whole stream over.
    }
  }
}

export async function streamMessage(options: StreamOptions): Promise<void> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": options.apiKey,
      "anthropic-version": API_VERSION,
      // The panel runs inside a webview, so the request has a browser origin.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: options.maxTokens ?? 2048,
      system: options.system,
      stream: true,
      messages: options.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });

  if (!response.ok) {
    // The body may carry a useful message, but it is never surfaced raw.
    throw new Error(messageForStatus(response.status));
  }

  const body = response.body;
  if (body === null) throw new Error("The API returned an empty response");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line; keep the trailing partial.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      parseSse(buffer.slice(0, boundary), options.onText);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (buffer !== "") parseSse(buffer, options.onText);
}
