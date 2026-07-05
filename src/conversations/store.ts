import {
  createDurable,
  type DurableValue,
  type Slot,
} from "@0xsarwagya/durable-local";

// Concrete shapes for readability, plus an index signature so
// durable-local's `T extends DurableValue` constraint accepts them.
// Every declared field is JSON-compatible.
export interface PeerRecord {
  ghostId: string;
  publicKey: string;
  displayName: string;
  firstSeenAt: number;
  lastSeenAt: number;
  [key: string]: DurableValue;
}

export interface ChatMessage {
  id: string;
  senderGhostId: string;
  text: string;
  sentAt: number;
  receivedAt: number;
  committed: true;
  [key: string]: DurableValue;
}

export interface ConversationState {
  peer: PeerRecord;
  conversation: ChatMessage[];
  [key: string]: DurableValue;
}

const durable = createDurable({ namespace: "local-chat" });

/** Open (or create) the slot for a peer. */
export async function openConversation(
  peer: {
    ghostId: string;
    publicKey: string;
    displayName: string;
  },
): Promise<Slot<ConversationState>> {
  const slotName = slotFor(peer.ghostId);
  return durable.open<ConversationState>(slotName, {
    initial: {
      peer: {
        ghostId: peer.ghostId,
        publicKey: peer.publicKey,
        displayName: peer.displayName.slice(0, 64),
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      },
      conversation: [],
    },
    version: 1,
    validate: validateConversationState,
  });
}

export function slotFor(ghostId: string): string {
  // durable-local's slot-name grammar: lowercase letters, digits, . _ -,
  // starting with a letter/digit, <= 128 chars. `ghost_1_...` already
  // matches, so we just prefix.
  return `conv.${ghostId}`;
}

function validateConversationState(value: unknown): ConversationState {
  if (typeof value !== "object" || value === null) {
    throw new Error("conversation state must be an object");
  }
  const s = value as Record<string, unknown>;
  const peer = s.peer as Partial<PeerRecord> | undefined;
  const conversation = s.conversation as unknown[] | undefined;
  if (
    !peer ||
    typeof peer.ghostId !== "string" ||
    typeof peer.publicKey !== "string" ||
    typeof peer.displayName !== "string" ||
    typeof peer.firstSeenAt !== "number" ||
    typeof peer.lastSeenAt !== "number"
  ) {
    throw new Error("conversation.peer shape");
  }
  if (!Array.isArray(conversation)) {
    throw new Error("conversation.conversation must be an array");
  }
  for (const raw of conversation) {
    if (typeof raw !== "object" || raw === null) {
      throw new Error("conversation message shape");
    }
    const m = raw as Record<string, unknown>;
    if (
      typeof m.id !== "string" ||
      typeof m.senderGhostId !== "string" ||
      typeof m.text !== "string" ||
      typeof m.sentAt !== "number" ||
      typeof m.receivedAt !== "number" ||
      m.committed !== true
    ) {
      throw new Error("conversation message field types");
    }
  }
  return value as ConversationState;
}

/**
 * Guard: refuse to attach a live connection to an existing slot if the
 * remote public key differs from what was pinned. See §10 of the recipe.
 */
export async function pinOrCheckPeerKey(
  slot: Slot<ConversationState>,
  claimed: { ghostId: string; publicKey: string; displayName: string },
): Promise<void> {
  if (slot.value.peer.publicKey !== claimed.publicKey) {
    throw new Error(
      `Peer ${claimed.ghostId} presented a different public key than was ` +
        `previously pinned. This may be a recovered identity — Local v1 ` +
        `refuses to attach silently. Verify out-of-band before continuing.`,
    );
  }
  await slot.update((current) => ({
    ...current,
    peer: {
      ...current.peer,
      displayName: claimed.displayName.slice(0, 64),
      lastSeenAt: Date.now(),
    },
  }));
}
