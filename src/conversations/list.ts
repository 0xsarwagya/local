import { createDurable, type DurableValue } from "@0xsarwagya/durable-local";

import type { ConversationState } from "./store";

export interface ConversationSummary {
  ghostId: string;
  displayName: string;
  messageCount: number;
  revision: number;
  lastSeenAt: number;
}

/**
 * durable-local v1 has no enumeration API. This helper reads the peer
 * ids from a small index slot; the connection code writes to the index
 * on first-contact commit.
 */
const durable = createDurable({ namespace: "local-chat" });

const INDEX_SLOT = "conversations.index";

interface Index {
  ghostIds: string[];
  [key: string]: DurableValue;
}

export async function getConversations(): Promise<ConversationSummary[]> {
  const indexSlot = await durable.open<Index>(INDEX_SLOT, {
    initial: { ghostIds: [] },
  });
  const summaries: ConversationSummary[] = [];
  for (const ghostId of indexSlot.value.ghostIds) {
    try {
      const slot = await durable.open<ConversationState>(
        `conv.${ghostId}`,
        {
          initial: {
            peer: {
              ghostId,
              publicKey: "",
              displayName: "",
              firstSeenAt: 0,
              lastSeenAt: 0,
            },
            conversation: [],
          },
        },
      );
      if (slot.value.peer.publicKey === "") continue;
      summaries.push({
        ghostId,
        displayName: slot.value.peer.displayName || "unnamed",
        messageCount: slot.value.conversation.length,
        revision: slot.revision,
        lastSeenAt: slot.value.peer.lastSeenAt,
      });
    } catch {
      /* skip corrupt entries */
    }
  }
  return summaries.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export async function registerConversation(ghostId: string): Promise<void> {
  const indexSlot = await durable.open<Index>(INDEX_SLOT, {
    initial: { ghostIds: [] },
  });
  if (indexSlot.value.ghostIds.includes(ghostId)) return;
  await indexSlot.update((current) => ({
    ghostIds: [...current.ghostIds, ghostId],
  }));
}
