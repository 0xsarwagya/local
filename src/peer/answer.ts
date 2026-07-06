import { createHandoff, type HandoffOffer } from "@0xsarwagya/handoff";
import type { Ghost } from "@0xsarwagya/ghost";
import { createChallenge, verifyGhostProof } from "@0xsarwagya/ghost/server";

import type { AnswerBootstrap, OfferBootstrap } from "./bootstrap";
import { PROTOCOL, VERSION } from "./bootstrap";
import { SessionChallengeStore } from "./challenge-store";
import { RTC_CONFIG, waitForIceGatheringComplete } from "./rtc";

const AUDIENCE = "local-chat";
const ACTION = "peer-hello";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface AnswerResult {
  pc: RTCPeerConnection;
  channel: Promise<RTCDataChannel>;
  challengeStore: SessionChallengeStore;
  bootstrap: AnswerBootstrap;
  handoff: HandoffOffer;
  gathering: "complete" | "timeout";
  /** The offerer's identity — B never trusts it beyond this, but pins it here. */
  offererIdentity: OfferBootstrap["offerer"];
}

/**
 * Peer B — apply the offer bootstrap, produce an answer bootstrap.
 * The returned `channel` promise resolves when B's ondatachannel fires
 * (i.e. after A applies the answer). B never calls createDataChannel.
 */
export async function createAnswer(input: {
  ghost: Ghost;
  displayName: string;
  offerBootstrap: OfferBootstrap;
  receiveUrl: string;
}): Promise<AnswerResult> {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  // Wait for A's data channel to arrive. Wrap in a promise so callers
  // can await it after handing off the answer.
  const channel = new Promise<RTCDataChannel>((resolve) => {
    pc.ondatachannel = (event) => resolve(event.channel);
  });

  await pc.setRemoteDescription({
    type: input.offerBootstrap.sdp.type,
    sdp: input.offerBootstrap.sdp.sdp,
  });

  await pc.createAnswer();
  await pc.setLocalDescription();

  const gathering = await waitForIceGatheringComplete(pc, 5_000);

  const localDesc = pc.localDescription;
  if (!localDesc || !localDesc.sdp || localDesc.type !== "answer") {
    throw new Error("no local answer produced");
  }

  // B signs the challenge A pre-issued in the offer bootstrap. This
  // travels back to A inside the answer bootstrap so A can verify B
  // before applying setRemoteDescription.
  const answererProof = await input.ghost.sign(
    input.offerBootstrap.challengeForAnswerer,
  );

  // B issues a challenge for A to sign after the data channel opens.
  const challengeStore = new SessionChallengeStore();
  const challengeForOfferer = createChallenge({
    audience: AUDIENCE,
    action: ACTION,
    ttlMs: CHALLENGE_TTL_MS,
  });
  challengeStore.issue(challengeForOfferer);

  const bootstrap: AnswerBootstrap = {
    protocol: PROTOCOL,
    version: VERSION,
    role: "answer",
    answerer: {
      ghostId: input.ghost.id,
      publicKey: input.ghost.publicKey,
      displayName: input.displayName.slice(0, 64),
    },
    sdp: { type: "answer", sdp: localDesc.sdp },
    answererProof,
    challengeForOfferer,
    createdAt: Date.now(),
  };

  const handoffApi = createHandoff({ receiveUrl: input.receiveUrl });
  const handoff = await handoffApi.create(
    bootstrap as unknown as import("@0xsarwagya/handoff").HandoffState,
    { limit: 16_384 },
  );

  return {
    pc,
    channel,
    challengeStore,
    bootstrap,
    handoff,
    gathering,
    offererIdentity: input.offerBootstrap.offerer,
  };
}

/**
 * A → consume B's answer bootstrap.
 * Verifies B's proof against A's challenge, then applies setRemoteDescription.
 * On success, the data channel A created will fire onopen shortly after.
 */
export async function applyAnswerBootstrap(input: {
  pc: RTCPeerConnection;
  challengeStore: SessionChallengeStore;
  answerBootstrap: AnswerBootstrap;
}): Promise<void> {
  const { pc, challengeStore, answerBootstrap } = input;

  // Modern Ghost IDs are random-derived, so verifyGhostProof requires a
  // credentialStore to confirm the (ghostId, credentialId, publicKey)
  // triple is active. B's answer bootstrap already carries the peer's
  // advertised (ghostId, publicKey) — that pair, delivered out-of-band
  // via the handoff, IS our trust anchor. An inline store that only
  // accepts that exact pair is the right shape for peer-to-peer.
  const peerCredentialStore = {
    isCredentialActive: async (
      ghostId: string,
      _credentialId: string,
      publicKey: string,
    ): Promise<boolean> =>
      ghostId === answerBootstrap.answerer.ghostId &&
      publicKey === answerBootstrap.answerer.publicKey,
  };

  const verification = await verifyGhostProof(answerBootstrap.answererProof, {
    expectedAudience: AUDIENCE,
    expectedAction: ACTION,
    expectedGhostId: answerBootstrap.answerer.ghostId,
    challengeStore,
    credentialStore: peerCredentialStore,
  });

  if (!verification.ok) {
    throw new Error(
      `Peer identity verification failed: ${verification.code} — ${verification.message}`,
    );
  }
  if (verification.publicKey !== answerBootstrap.answerer.publicKey) {
    throw new Error("Peer proof carried a different public key than the bootstrap claim.");
  }

  await pc.setRemoteDescription({
    type: answerBootstrap.sdp.type,
    sdp: answerBootstrap.sdp.sdp,
  });
}
