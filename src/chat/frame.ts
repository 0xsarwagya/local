import type { GhostProof } from "@0xsarwagya/ghost";

/**
 * On-wire frame protocol for local-chat. Version negotiation lives in
 * the HelloBody (blocker B7) — subsequent frames have no version tag;
 * the connection-level version is fixed once both peers agree.
 */

export const CHAT_PROTOCOL = "local-chat" as const;
export const SUPPORTED_CHAT_VERSIONS = [1] as const;

export type FrameType = "hello" | "message" | "ack";

export interface HelloBody {
  supportedVersions: number[];
  selectedVersion: number;
  proof: GhostProof;
}

export interface MessageBody {
  kind: "text";
  text: string;
}

export interface AckBody {
  ackId: string;
}

export type FrameBody = HelloBody | MessageBody | AckBody;

export interface Frame<B extends FrameBody = FrameBody> {
  protocol: typeof CHAT_PROTOCOL;
  type: FrameType;
  id: string;
  sentAt: number;
  body: B;
}

/** 128-bit random base64url id (22 chars). */
export function newFrameId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

const FRAME_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const LIMITS = {
  /** Max raw datagram size (bytes) accepted at the WebRTC layer. */
  DATAGRAM_MAX: 8 * 1024,
  /** Max text message body UTF-8 bytes. */
  TEXT_BODY_MAX: 4 * 1024,
  /** LRU size for incoming-id de-dup. */
  SEEN_LRU: 256,
  /** LRU size for outgoing-id -> can-ack cache. */
  SENT_LRU: 256,
  /** Rate-limit token bucket max. */
  RL_BUCKET_MAX: 20,
  /** Rate-limit refill (frames per second). */
  RL_REFILL_PER_SEC: 4,
  /** Rate-limit strike count before teardown. */
  RL_STRIKE_TEARDOWN: 5,
  /** Rate-limit strike window (ms). */
  RL_STRIKE_WINDOW_MS: 30_000,
  /** Data-channel bufferedAmount cap; block send above this. */
  BACKPRESSURE_HIGH: 1_048_576,
  /** Resume-send threshold. */
  BACKPRESSURE_LOW: 262_144,
} as const;

export type ValidationResult =
  | { ok: true; frame: Frame }
  | { ok: false; code: ValidationCode; detail?: string };

export type ValidationCode =
  | "TOO_LARGE"
  | "PARSE_FAILED"
  | "ENVELOPE_SHAPE"
  | "PROTOCOL_UNKNOWN"
  | "TYPE_UNKNOWN"
  | "BODY_SHAPE"
  | "DUPLICATE_ID";

/**
 * Steps 1–5 of the untrusted-peer validation pipeline. Returns a shape
 * decision only — the semantic checks (rate limit, state gating) and
 * the LRU insertion happen in connection.ts.
 */
export function validateIncomingRaw(
  raw: string,
  seenIds: Set<string>,
): ValidationResult {
  // Step 1 — byte-size gate. Reject before JSON.parse.
  if (
    new TextEncoder().encode(raw).byteLength > LIMITS.DATAGRAM_MAX
  ) {
    return { ok: false, code: "TOO_LARGE" };
  }

  // Step 2 — JSON parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, code: "PARSE_FAILED", detail: (err as Error).message };
  }

  // Step 3 — envelope shape.
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, code: "ENVELOPE_SHAPE" };
  }
  const f = parsed as Record<string, unknown>;
  if (f.protocol !== CHAT_PROTOCOL) {
    return { ok: false, code: "PROTOCOL_UNKNOWN" };
  }
  if (typeof f.type !== "string") {
    return { ok: false, code: "ENVELOPE_SHAPE" };
  }
  if (typeof f.id !== "string" || !FRAME_ID_PATTERN.test(f.id)) {
    return { ok: false, code: "ENVELOPE_SHAPE" };
  }
  if (typeof f.sentAt !== "number" || !Number.isFinite(f.sentAt)) {
    return { ok: false, code: "ENVELOPE_SHAPE" };
  }
  if (typeof f.body !== "object" || f.body === null) {
    return { ok: false, code: "ENVELOPE_SHAPE" };
  }

  // Step 4 — type-specific body shape.
  const body = f.body as Record<string, unknown>;
  switch (f.type) {
    case "hello": {
      if (
        !Array.isArray(body.supportedVersions) ||
        body.supportedVersions.length === 0 ||
        !body.supportedVersions.every((v) => typeof v === "number") ||
        typeof body.selectedVersion !== "number" ||
        typeof body.proof !== "object" ||
        body.proof === null
      ) {
        return { ok: false, code: "BODY_SHAPE" };
      }
      break;
    }
    case "message": {
      if (
        body.kind !== "text" ||
        typeof body.text !== "string" ||
        body.text.length === 0 ||
        new TextEncoder().encode(body.text).byteLength > LIMITS.TEXT_BODY_MAX
      ) {
        return { ok: false, code: "BODY_SHAPE" };
      }
      break;
    }
    case "ack": {
      if (
        typeof body.ackId !== "string" ||
        !FRAME_ID_PATTERN.test(body.ackId)
      ) {
        return { ok: false, code: "BODY_SHAPE" };
      }
      break;
    }
    default:
      return { ok: false, code: "TYPE_UNKNOWN" };
  }

  // Step 5 — frame-id replay guard.
  if (seenIds.has(f.id)) {
    return { ok: false, code: "DUPLICATE_ID" };
  }

  return { ok: true, frame: parsed as Frame };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
