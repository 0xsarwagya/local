# Local

I refuse to use servers for stupidly simple things.

A direct browser-to-browser chat built with
[Ghost](https://oss.sarwagya.wtf/ghost),
[durable-local](https://oss.sarwagya.wtf/durable-local),
[Handoff](https://oss.sarwagya.wtf/handoff), and WebRTC.

```
Identity              Ghost
History               durable-local
Connection bootstrap  Handoff
Communication         WebRTC
```

**No account server. No message database. No chat server. No signaling
backend.**

Local hosts static files. Google + Cloudflare STUN is used for
public-address discovery — a STUN server does not observe application
state, keys, or messages. No TURN in v1: about 15–20% of network pairs
(symmetric NAT, corporate firewalls, some cellular carriers) will not
connect without a relay. Local surfaces that failure honestly; try from
a different network.

## Try it

https://local.sarwagya.wtf

Two people. One shows the QR code (or copies the invitation). The other
scans/pastes, accepts, and shows a reply. They connect. They talk. The
absence is the architecture.

## What lives where

- `src/identity/` — thin wrapper around Ghost. One `ghost` per browser.
- `src/peer/` — RTCPeerConnection ceremony, offer/answer bootstraps,
  session challenge store, live connection driver.
- `src/chat/` — on-wire chat protocol + untrusted-peer frame validation.
- `src/conversations/` — durable-local slots for peer records and
  message history.
- `src/ui/` — React shell. Home, Session (invite/join/verify/chat), and
  the small QR view.

## Constraints made explicit

- **v1 first-contact only accepts key-derived Ghost IDs.** Recovered or
  rotated identities are legitimate but require prior pinning, which
  v1 does not offer.
- **Every incoming frame is treated as hostile.** Byte-size gate, JSON
  parse, envelope shape, type-specific body shape, per-connection LRU
  replay guard, token-bucket rate limit, then semantic checks.
- **Storage is not confidentiality.** Anything at the same origin can
  read Local's slots. The library it uses (durable-local) says the
  same thing.
- **Same-origin XSS breaks the model.** Local has no defense here that
  any other same-origin JS wouldn't also lose.

## License

MIT.
