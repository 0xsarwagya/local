import { createHandoff } from "@0xsarwagya/handoff";

import { assertOfferBootstrap, type OfferBootstrap } from "./bootstrap";

/**
 * If the page was opened via an invitation URL (…#handoff=ho1_…),
 * consume it, validate the shape, and return the offer bootstrap.
 * The fragment is scrubbed so a reload does not re-trigger the flow.
 */
export async function readIncomingBootstrap(): Promise<OfferBootstrap | null> {
  if (typeof window === "undefined") return null;
  const handoff = createHandoff({ receiveUrl: window.location.href });
  if (!handoff.peek()) return null;
  try {
    const raw = await handoff.receive(undefined, { scrub: true });
    assertOfferBootstrap(raw);
    return raw;
  } catch {
    // Malformed / tampered / expired — drop silently. The UI will
    // show the empty home state; the user can re-request the link.
    return null;
  }
}
