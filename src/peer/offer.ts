import { createHandoff, type HandoffOffer } from "@0xsarwagya/handoff";
import { deriveGhostId, type Ghost } from "@0xsarwagya/ghost";
import { createChallenge } from "@0xsarwagya/ghost/server";

import type { OfferBootstrap } from "./bootstrap";
import { PROTOCOL, VERSION } from "./bootstrap";
import { SessionChallengeStore } from "./challenge-store";
import { RTC_CONFIG, waitForIceGatheringComplete } from "./rtc";

const AUDIENCE = "local-chat";
const ACTION = "peer-hello";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface OfferResult {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  challengeStore: SessionChallengeStore;
  bootstrap: OfferBootstrap;
  handoff: HandoffOffer;
  /** iceGatheringComplete or fell back to partial candidates. */
  gathering: "complete" | "timeout";
}

/**
 * Peer A — create the offer bootstrap + Handoff artifact.
 * Does NOT wait for the answer; that happens via
 * applyAnswerBootstrap() when the user pastes B's return artifact.
 */
export async function createOffer(input: {
  ghost: Ghost;
  displayName: string;
  receiveUrl: string;
}): Promise<OfferResult> {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  // Data channel MUST be created before createOffer — otherwise the
  // SDP contains no m=application section and B never fires
  // ondatachannel.
  const channel = pc.createDataChannel("local-chat", {
    ordered: true,
    negotiated: false,
  });

  await pc.createOffer();
  // no-arg setLocalDescription: use the offer we just created.
  await pc.setLocalDescription();

  const gathering = await waitForIceGatheringComplete(pc, 5_000);

  const localDesc = pc.localDescription;
  if (!localDesc || !localDesc.sdp || localDesc.type !== "offer") {
    throw new Error("no local offer produced");
  }

  // Sanity: the ghostId in the bootstrap must be derivable from the
  // public key. Ghost enforces this for first-contact anyway; asserting
  // here catches any inconsistency in the identity store early.
  const derived = await deriveGhostId(
    base64UrlToBytes(input.ghost.publicKey),
  );
  if (derived !== input.ghost.id) {
    throw new Error(
      "Local v1 first-contact requires key-derived ghostIds. " +
        "This browser's ghost identity was recovered/rotated; recovery is " +
        "not supported for first-contact peers in v1.",
    );
  }

  const challengeStore = new SessionChallengeStore();
  const challengeForAnswerer = createChallenge({
    audience: AUDIENCE,
    action: ACTION,
    ttlMs: CHALLENGE_TTL_MS,
  });
  challengeStore.issue(challengeForAnswerer);

  const bootstrap: OfferBootstrap = {
    protocol: PROTOCOL,
    version: VERSION,
    role: "offer",
    offerer: {
      ghostId: input.ghost.id,
      publicKey: input.ghost.publicKey,
      displayName: input.displayName.slice(0, 64),
    },
    sdp: { type: "offer", sdp: localDesc.sdp },
    challengeForAnswerer,
    createdAt: Date.now(),
  };

  const handoffApi = createHandoff({ receiveUrl: input.receiveUrl });
  const handoff = await handoffApi.create(
    // Handoff owns the wire encoding; JSON is fine because it's already
    // deflate+base64url'd inside the artifact.
    bootstrap as unknown as import("@0xsarwagya/handoff").HandoffState,
    { limit: 16_384 },
  );

  return { pc, channel, challengeStore, bootstrap, handoff, gathering };
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
