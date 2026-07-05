import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../conversations/store";

type Props = {
  peerName: string;
  peerSas: string;
  peerGhostId: string;
  ownGhostId: string;
  messages: ChatMessage[];
  onSend: (text: string) => { id: string } | { error: string };
  onLeave: () => void;
};

export function ChatView(props: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [props.messages]);

  const send = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    const result = props.onSend(text);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft("");
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-baseline justify-between border-b border-ink/10 pb-4">
        <div>
          <p className="font-serif text-[22px] italic">{props.peerName}</p>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="label transition-colors hover:text-rust"
          >
            <span
              className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle"
              style={{ backgroundColor: "var(--color-rust)" }}
            />
            Direct
          </button>
        </div>
        <button
          type="button"
          onClick={props.onLeave}
          className="label transition-colors hover:text-rust"
        >
          Leave
        </button>
      </header>

      {showDetails ? (
        <section className="border-b border-ink/10 py-3 font-mono text-[11px] text-stone">
          <p>
            Peer fingerprint · <span className="text-ink">{props.peerSas}</span>
          </p>
          <p className="mt-1 truncate">
            Ghost · <span className="text-ink/80">{props.peerGhostId}</span>
          </p>
          <p className="mt-3 leading-relaxed">
            Messages are stored separately on each browser. Local does not
            operate a message server; this session is a direct WebRTC
            connection.
          </p>
        </section>
      ) : null}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto py-6"
      >
        {props.messages.length === 0 ? (
          <p className="font-serif italic text-ink/60">
            Nothing yet. Say hello.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {props.messages.map((m) => (
              <li
                key={m.id}
                className={
                  m.senderGhostId === props.ownGhostId
                    ? "flex flex-col items-end"
                    : "flex flex-col items-start"
                }
              >
                <p
                  className={
                    "max-w-[75%] whitespace-pre-wrap break-words px-3 py-2 text-[15px] leading-snug " +
                    (m.senderGhostId === props.ownGhostId
                      ? "bg-ink/[0.05] text-ink"
                      : "border border-ink/10 text-ink")
                  }
                >
                  {m.text}
                </p>
                <span className="mt-1 font-mono text-[10px] text-stone/70">
                  {formatTime(m.sentAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-ink/10 pt-4">
        {error ? (
          <p className="pb-2 font-mono text-[11px] text-rust">{error}</p>
        ) : null}
        <div className="flex items-end gap-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Say something…"
            rows={1}
            className="min-h-[44px] flex-1 resize-none border border-ink/20 bg-transparent px-3 py-2 text-[15px] text-ink placeholder:text-stone/40 focus:border-rust focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={draft.trim().length === 0}
            className="border border-ink/25 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.16em] text-ink transition-colors hover:border-rust hover:text-rust disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
