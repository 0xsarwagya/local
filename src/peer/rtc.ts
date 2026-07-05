/**
 * RTCPeerConnection helpers. Pure WebRTC — no Ghost, no Handoff, no UI.
 * The ceremony (§1–§7 of the design recipe) is orchestrated by
 * offer.ts / answer.ts on top of this.
 */

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun.l.google.com:5349"] },
    { urls: ["stun:stun.cloudflare.com:3478"] },
  ],
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceCandidatePoolSize: 0,
  iceTransportPolicy: "all",
};

/**
 * Wait until ICE gathering completes, or until `timeoutMs` elapses —
 * whichever fires first. On timeout, resolves with `"timeout"` so the
 * caller can proceed with whatever candidates are already in the SDP.
 * A LAN-only run may never fire "complete" cleanly and we still want
 * to ship the offer.
 */
export function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  timeoutMs = 5000,
): Promise<"complete" | "timeout"> {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve("complete");
  }
  return new Promise((resolve) => {
    let done = false;
    const check = () => {
      if (done) return;
      if (pc.iceGatheringState === "complete") {
        done = true;
        cleanup();
        resolve("complete");
      }
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      resolve("timeout");
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
    };
    pc.addEventListener("icegatheringstatechange", check);
    // Re-check in case the state moved to "complete" between the
    // top-of-function check and the listener attach.
    check();
  });
}

/**
 * Wait until an RTCDataChannel enters the "open" state.
 * Rejects on close/error while still opening.
 */
export function waitForChannelOpen(
  channel: RTCDataChannel,
  timeoutMs = 20_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (channel.readyState === "open") {
      resolve();
      return;
    }
    if (channel.readyState === "closing" || channel.readyState === "closed") {
      reject(new Error(`data channel is ${channel.readyState}`));
      return;
    }
    let done = false;
    const onOpen = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("data channel error before open"));
    };
    const onClose = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("data channel closed before open"));
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("data channel open timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("error", onError);
      channel.removeEventListener("close", onClose);
    };
    channel.addEventListener("open", onOpen);
    channel.addEventListener("error", onError);
    channel.addEventListener("close", onClose);
  });
}
