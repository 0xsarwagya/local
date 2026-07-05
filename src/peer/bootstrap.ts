import type { GhostChallenge, GhostProof } from "@0xsarwagya/ghost";

/**
 * The application-level payload Local wraps around WebRTC SDP.
 * Never trust any field for identity — presentation only until the
 * Ghost mutual verification (§8 of the recipe) has succeeded.
 */

export const PROTOCOL = "local-signaling" as const;
export const VERSION = 1 as const;

export type PeerIdentity = {
  ghostId: string;
  publicKey: string;
  /** <= 64 chars, untrusted, presentation only. */
  displayName: string;
};

export interface OfferBootstrap {
  protocol: typeof PROTOCOL;
  version: typeof VERSION;
  role: "offer";
  offerer: PeerIdentity;
  sdp: {
    type: "offer";
    sdp: string;
  };
  /** Challenge B must sign back to A. */
  challengeForAnswerer: GhostChallenge;
  createdAt: number;
}

export interface AnswerBootstrap {
  protocol: typeof PROTOCOL;
  version: typeof VERSION;
  role: "answer";
  answerer: PeerIdentity;
  sdp: {
    type: "answer";
    sdp: string;
  };
  /** B's signature over A's challengeForAnswerer. */
  answererProof: GhostProof;
  /** Challenge A must sign back to B over the data channel. */
  challengeForOfferer: GhostChallenge;
  createdAt: number;
}

const GHOST_ID_PATTERN = /^ghost_\d+_[a-z2-7]{16,64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

function assertString(v: unknown, label: string, max = 256): asserts v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) {
    throw new Error(`bootstrap.${label} must be a non-empty string <= ${max} chars`);
  }
}

function assertPositiveInt(v: unknown, label: string): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new Error(`bootstrap.${label} must be a finite non-negative number`);
  }
}

function assertPeerIdentity(v: unknown, label: string): asserts v is PeerIdentity {
  if (typeof v !== "object" || v === null) {
    throw new Error(`bootstrap.${label} must be an object`);
  }
  const p = v as Record<string, unknown>;
  assertString(p.ghostId, `${label}.ghostId`, 128);
  if (!GHOST_ID_PATTERN.test(p.ghostId as string)) {
    throw new Error(`bootstrap.${label}.ghostId shape`);
  }
  assertString(p.publicKey, `${label}.publicKey`, 128);
  if (!BASE64URL_PATTERN.test(p.publicKey as string)) {
    throw new Error(`bootstrap.${label}.publicKey shape`);
  }
  assertString(p.displayName, `${label}.displayName`, 64);
}

function assertChallenge(v: unknown, label: string): asserts v is GhostChallenge {
  if (typeof v !== "object" || v === null) {
    throw new Error(`bootstrap.${label} must be an object`);
  }
  const c = v as Record<string, unknown>;
  if (c.version !== 1) throw new Error(`bootstrap.${label}.version must be 1`);
  assertString(c.nonce, `${label}.nonce`, 128);
  assertString(c.audience, `${label}.audience`, 128);
  assertString(c.action, `${label}.action`, 64);
  assertPositiveInt(c.expiresAt, `${label}.expiresAt`);
}

function assertProof(v: unknown, label: string): asserts v is GhostProof {
  if (typeof v !== "object" || v === null) {
    throw new Error(`bootstrap.${label} must be an object`);
  }
  const p = v as Record<string, unknown>;
  if (p.version !== 1) throw new Error(`bootstrap.${label}.version must be 1`);
  if (p.algorithm !== "ed25519") throw new Error(`bootstrap.${label}.algorithm`);
  assertString(p.ghostId, `${label}.ghostId`, 128);
  assertString(p.credentialId, `${label}.credentialId`, 128);
  assertString(p.publicKey, `${label}.publicKey`, 128);
  assertString(p.signature, `${label}.signature`, 128);
  assertChallenge(p.challenge, `${label}.challenge`);
}

export function assertOfferBootstrap(v: unknown): asserts v is OfferBootstrap {
  if (typeof v !== "object" || v === null) {
    throw new Error("bootstrap must be an object");
  }
  const o = v as Record<string, unknown>;
  if (o.protocol !== PROTOCOL) throw new Error("bootstrap.protocol");
  if (o.version !== VERSION) throw new Error("bootstrap.version — unsupported");
  if (o.role !== "offer") throw new Error("bootstrap.role must be 'offer'");
  assertPeerIdentity(o.offerer, "offerer");
  if (typeof o.sdp !== "object" || o.sdp === null) {
    throw new Error("bootstrap.sdp must be an object");
  }
  const sdp = o.sdp as Record<string, unknown>;
  if (sdp.type !== "offer") throw new Error("bootstrap.sdp.type");
  assertString(sdp.sdp, "sdp.sdp", 16_384);
  assertChallenge(o.challengeForAnswerer, "challengeForAnswerer");
  assertPositiveInt(o.createdAt, "createdAt");
}

export function assertAnswerBootstrap(v: unknown): asserts v is AnswerBootstrap {
  if (typeof v !== "object" || v === null) {
    throw new Error("bootstrap must be an object");
  }
  const a = v as Record<string, unknown>;
  if (a.protocol !== PROTOCOL) throw new Error("bootstrap.protocol");
  if (a.version !== VERSION) throw new Error("bootstrap.version — unsupported");
  if (a.role !== "answer") throw new Error("bootstrap.role must be 'answer'");
  assertPeerIdentity(a.answerer, "answerer");
  if (typeof a.sdp !== "object" || a.sdp === null) {
    throw new Error("bootstrap.sdp must be an object");
  }
  const sdp = a.sdp as Record<string, unknown>;
  if (sdp.type !== "answer") throw new Error("bootstrap.sdp.type");
  assertString(sdp.sdp, "sdp.sdp", 16_384);
  assertProof(a.answererProof, "answererProof");
  assertChallenge(a.challengeForOfferer, "challengeForOfferer");
  assertPositiveInt(a.createdAt, "createdAt");
}
