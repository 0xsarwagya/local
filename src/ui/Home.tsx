import { useEffect, useState } from "react";

import { getIdentity } from "../identity/store";
import type { LocalIdentity } from "../identity/store";
import { getConversations, type ConversationSummary } from "../conversations/list";

type Props = { onStart: () => void };

export function Home({ onStart }: Props) {
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    (async () => {
      const id = await getIdentity();
      setIdentity(id);
      setConversations(await getConversations());
    })();
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mt-2 flex items-baseline justify-between">
        <span className="label">Local</span>
        <span className="label">You are here</span>
      </header>

      <section className="mt-24 flex flex-1 flex-col justify-center gap-8 md:mt-32">
        <h1
          className="font-serif italic tracking-tight text-ink"
          style={{ fontSize: "clamp(40px, 7vw, 72px)", lineHeight: 1.02 }}
        >
          Talk directly.
        </h1>
        <p className="max-w-md text-[15px] leading-relaxed text-ink/80">
          No account. No message database. No chat server. No signaling
          backend. Your history stays in this browser.
        </p>

        <div>
          <button
            type="button"
            onClick={onStart}
            className="border border-ink/25 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-ink transition-colors hover:border-rust hover:text-rust"
          >
            Start a conversation
          </button>
        </div>
      </section>

      {conversations.length > 0 ? (
        <section className="mt-16">
          <p className="label">Conversations</p>
          <ul className="mt-4 flex flex-col divide-y divide-ink/10">
            {conversations.map((c) => (
              <li key={c.ghostId} className="py-3">
                <span className="font-serif text-[17px]">{c.displayName}</span>
                <span className="ml-3 font-mono text-[11px] text-stone">
                  {c.messageCount} · rev {c.revision}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-auto flex flex-col gap-6 pt-16 sm:flex-row sm:items-end sm:justify-between">
        {identity ? (
          <div className="flex flex-col gap-1 text-[11px] text-ink/60">
            <span className="label">This browser</span>
            <span className="font-mono">{identity.short}</span>
          </div>
        ) : (
          <span className="label">Loading identity…</span>
        )}

        <nav
          aria-label="Attribution"
          className="flex flex-col gap-1 font-mono text-[11px] text-stone sm:items-end"
        >
          <a
            href="https://me.sarwagya.wtf"
            rel="author me noopener"
            target="_blank"
            className="transition-colors hover:text-rust"
          >
            Built by Sarwagya
          </a>
          <a
            href="https://oss.sarwagya.wtf"
            rel="me noopener"
            target="_blank"
            className="transition-colors hover:text-rust"
          >
            How this works
          </a>
        </nav>
      </footer>
    </div>
  );
}
