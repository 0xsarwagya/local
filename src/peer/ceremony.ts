import { createHandoff } from "@0xsarwagya/handoff";
import type { Ghost } from "@0xsarwagya/ghost";

import { assertAnswerBootstrap, type OfferBootstrap } from "./bootstrap";
import { Connection } from "./connection";
import type { ConnectionEvents } from "./connection";
import { createOffer } from "./offer";
import { applyAnswerBootstrap, createAnswer } from "./answer";
import { waitForChannelOpen } from "./rtc";

/**
 * Pure ceremony functions — no React, no window globals. The Session
 * hook drives these; they return the assembled Connection.
 */

export interface OffererCeremonyHandle {
  invitationUrl: string;
  invitationArtifact: string;
  qrFriendly: boolean;
  cancel: () => void;
  submitAnswer: (rawAnswerArtifact: string) => Promise<{
    connection: Connection;
    peer: { ghostId: string; publicKey: string; displayName: string };
  }>;
}

export function beginOffererCeremony(input: {
  ghost: Ghost;
  displayName: string;
  receiveUrl: string;
  events: ConnectionEvents;
}): Promise<OffererCeremonyHandle> {
  return (async () => {
    const offer = await createOffer({
      ghost: input.ghost,
      displayName: input.displayName,
      receiveUrl: input.receiveUrl,
    });

    const cancel = () => {
      try {
        offer.pc.close();
      } catch {
        /* ignore */
      }
      offer.challengeStore.clear();
    };

    return {
      invitationUrl: offer.handoff.url,
      invitationArtifact: offer.handoff.artifact,
      qrFriendly: offer.handoff.qrFriendly,
      cancel,
      submitAnswer: async (rawAnswerArtifact) => {
        const handoffApi = createHandoff({ receiveUrl: input.receiveUrl });
        const answerBootstrap = await handoffApi.receive(rawAnswerArtifact);
        assertAnswerBootstrap(answerBootstrap);

        await applyAnswerBootstrap({
          pc: offer.pc,
          challengeStore: offer.challengeStore,
          answerBootstrap,
        });

        await waitForChannelOpen(offer.channel);

        const connection = new Connection({
          role: "offerer",
          pc: offer.pc,
          channel: offer.channel,
          challengeStore: offer.challengeStore,
          ghost: input.ghost,
          peerIdentity: answerBootstrap.answerer,
          challengeToSign: answerBootstrap.challengeForOfferer,
          // B's identity was already verified in applyAnswerBootstrap
          // (which consumed `challengeForAnswerer` from this store).
          // Re-verifying B's hello would double-consume the same nonce.
          peerAlreadyVerified: true,
          events: input.events,
        });
        await connection.start();

        return {
          connection,
          peer: answerBootstrap.answerer,
        };
      },
    };
  })();
}

export interface AnswererCeremonyHandle {
  peer: OfferBootstrap["offerer"];
  invitationArtifact: string;
  invitationUrl: string;
  qrFriendly: boolean;
  connectionPromise: Promise<Connection>;
  cancel: () => void;
}

export async function beginAnswererCeremony(input: {
  ghost: Ghost;
  displayName: string;
  offerBootstrap: OfferBootstrap;
  receiveUrl: string;
  events: ConnectionEvents;
}): Promise<AnswererCeremonyHandle> {
  const answer = await createAnswer({
    ghost: input.ghost,
    displayName: input.displayName,
    offerBootstrap: input.offerBootstrap,
    receiveUrl: input.receiveUrl,
  });

  const cancel = () => {
    try {
      answer.pc.close();
    } catch {
      /* ignore */
    }
    answer.challengeStore.clear();
  };

  const connectionPromise = (async () => {
    const channel = await answer.channel;
    await waitForChannelOpen(channel);
    const connection = new Connection({
      role: "answerer",
      pc: answer.pc,
      channel,
      challengeStore: answer.challengeStore,
      ghost: input.ghost,
      peerIdentity: input.offerBootstrap.offerer,
      challengeToSign: input.offerBootstrap.challengeForAnswerer,
      events: input.events,
    });
    await connection.start();
    return connection;
  })();

  return {
    peer: input.offerBootstrap.offerer,
    invitationArtifact: answer.handoff.artifact,
    invitationUrl: answer.handoff.url,
    qrFriendly: answer.handoff.qrFriendly,
    connectionPromise,
    cancel,
  };
}
