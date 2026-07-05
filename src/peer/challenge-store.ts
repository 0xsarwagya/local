import type { GhostChallenge } from "@0xsarwagya/ghost";
import type { ChallengeStore } from "@0xsarwagya/ghost/server";

/**
 * One store per RTCPeerConnection. Records challenges Local has
 * issued in this session, and consumes them exactly once when the
 * peer's proof against them is verified. Never shared across
 * connections — mixing nonces between peers would break the identity
 * binding.
 */
export class SessionChallengeStore implements ChallengeStore {
  private readonly issued = new Map<string, number>();

  /** Record that we issued this challenge; expected to see the proof back. */
  issue(challenge: GhostChallenge): void {
    this.issued.set(challenge.nonce, challenge.expiresAt);
  }

  /** ChallengeStore.consume: returns true if we issued and haven't seen this nonce yet. */
  async consume(nonce: string, expiresAt: number): Promise<boolean> {
    void expiresAt; // handled by the shape check in verifyGhostProof
    const known = this.issued.get(nonce);
    if (known === undefined) return false;
    this.issued.delete(nonce);
    return true;
  }

  /** Drop everything (called on pc.close()). */
  clear(): void {
    this.issued.clear();
  }
}
