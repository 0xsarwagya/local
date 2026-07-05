import { createGhost, capabilities, type Ghost } from "@0xsarwagya/ghost";

export interface LocalIdentity {
  ghost: Ghost;
  /** Short 12-char fingerprint for UI display. */
  short: string;
  /** SAS fingerprint (first 8 chars of ghostId, sans prefix) for first-contact verify. */
  sas: string;
}

let cached: Promise<LocalIdentity> | null = null;

/**
 * Get (or create) this browser's Ghost identity. Idempotent; cached in
 * memory after first call. Throws GhostError on runtimes that lack
 * Web Crypto Ed25519 or IndexedDB.
 */
export function getIdentity(): Promise<LocalIdentity> {
  if (cached !== null) return cached;
  cached = (async () => {
    const caps = await capabilities();
    if (!caps.supported) {
      throw new Error(
        `Local requires a browser with Web Crypto Ed25519 and IndexedDB. ` +
          `Capabilities: webCrypto=${caps.webCrypto} ed25519=${caps.ed25519} idb=${caps.indexedDB}`,
      );
    }
    const ghost = await createGhost();
    return {
      ghost,
      short: shortFingerprint(ghost.id),
      sas: sasFingerprint(ghost.id),
    };
  })();
  return cached;
}

/** Reset the in-memory cache (used by tests). */
export function __resetForTests(): void {
  cached = null;
}

/** 12-char display fingerprint: 4 groups of 3 base32 chars from the ghostId. */
function shortFingerprint(ghostId: string): string {
  const body = ghostId.replace(/^ghost_\d+_/, "");
  const trimmed = body.slice(0, 12);
  return `${trimmed.slice(0, 3)} ${trimmed.slice(3, 6)} ${trimmed.slice(6, 9)} ${trimmed.slice(9, 12)}`;
}

/** SAS: first 8 base32 chars of the ghostId body, spaced for readability. */
export function sasFingerprint(ghostId: string): string {
  const body = ghostId.replace(/^ghost_\d+_/, "");
  const trimmed = body.slice(0, 8).toUpperCase();
  return `${trimmed.slice(0, 4)} ${trimmed.slice(4, 8)}`;
}
