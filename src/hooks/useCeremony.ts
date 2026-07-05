import { useEffect, useReducer, useRef } from "react";

import type { Ghost } from "@0xsarwagya/ghost";

import type { OfferBootstrap } from "../peer/bootstrap";
import {
  beginAnswererCeremony,
  beginOffererCeremony,
  type AnswererCeremonyHandle,
  type OffererCeremonyHandle,
} from "../peer/ceremony";
import type { Connection } from "../peer/connection";
import { sasFingerprint } from "../identity/store";
import type { ChatMessage } from "../conversations/store";

const RECEIVE_URL = deriveReceiveUrl();
const OWN_DISPLAY_NAME_PREFIX = "guest";

export type Phase =
  | { kind: "starting" }
  | {
      kind: "inviting";
      url: string;
      artifact: string;
      qrFriendly: boolean;
    }
  | {
      kind: "reviewing";
      peerName: string;
      peerSas: string;
      peerGhostId: string;
    }
  | {
      kind: "answering";
      url: string;
      artifact: string;
      qrFriendly: boolean;
      peerName: string;
      peerSas: string;
    }
  | { kind: "connecting" }
  | { kind: "verifying"; peerName: string; peerSas: string }
  | {
      kind: "connected";
      peerName: string;
      peerSas: string;
      peerGhostId: string;
    }
  | { kind: "interrupted" }
  | { kind: "failed"; message: string }
  | { kind: "closed" };

type Action =
  | { type: "offerReady"; url: string; artifact: string; qrFriendly: boolean }
  | {
      type: "reviewPeer";
      peerName: string;
      peerSas: string;
      peerGhostId: string;
    }
  | {
      type: "answerReady";
      url: string;
      artifact: string;
      qrFriendly: boolean;
      peerName: string;
      peerSas: string;
    }
  | { type: "connecting" }
  | { type: "verifying"; peerName: string; peerSas: string }
  | {
      type: "connected";
      peerName: string;
      peerSas: string;
      peerGhostId: string;
    }
  | { type: "interrupted" }
  | { type: "failed"; message: string }
  | { type: "closed" };

function phaseReducer(_state: Phase, action: Action): Phase {
  switch (action.type) {
    case "offerReady":
      return {
        kind: "inviting",
        url: action.url,
        artifact: action.artifact,
        qrFriendly: action.qrFriendly,
      };
    case "reviewPeer":
      return {
        kind: "reviewing",
        peerName: action.peerName,
        peerSas: action.peerSas,
        peerGhostId: action.peerGhostId,
      };
    case "answerReady":
      return {
        kind: "answering",
        url: action.url,
        artifact: action.artifact,
        qrFriendly: action.qrFriendly,
        peerName: action.peerName,
        peerSas: action.peerSas,
      };
    case "connecting":
      return { kind: "connecting" };
    case "verifying":
      return {
        kind: "verifying",
        peerName: action.peerName,
        peerSas: action.peerSas,
      };
    case "connected":
      return {
        kind: "connected",
        peerName: action.peerName,
        peerSas: action.peerSas,
        peerGhostId: action.peerGhostId,
      };
    case "interrupted":
      return { kind: "interrupted" };
    case "failed":
      return { kind: "failed", message: action.message };
    case "closed":
      return { kind: "closed" };
  }
}

export interface CeremonyApi {
  phase: Phase;
  messages: ChatMessage[];
  ownGhostId: string;
  send: (text: string) => { id: string } | { error: string };
  accept: () => void;
  submitAnswer: (rawArtifact: string) => void;
  leave: () => void;
}

export type CeremonyRole =
  | { role: "offerer"; ghost: Ghost }
  | { role: "answerer"; ghost: Ghost; bootstrap: OfferBootstrap };

/**
 * Owns the ceremony state machine, connection lifecycle, and message
 * stream. Pure orchestration — no DOM, no UI decisions.
 */
export function useCeremony(input: CeremonyRole | null): CeremonyApi {
  const [phase, dispatch] = useReducer(phaseReducer, { kind: "starting" });
  const messagesRef = useRef<ChatMessage[]>([]);
  const [messages, setMessages] = useReducer(
    (_prev: ChatMessage[], next: ChatMessage[]) => next,
    [],
  );

  const offerHandleRef = useRef<OffererCeremonyHandle | null>(null);
  const answerHandleRef = useRef<AnswererCeremonyHandle | null>(null);
  const connectionRef = useRef<Connection | null>(null);
  const acceptRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (input === null) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const events = {
      onState: (state: string, detail?: string) => {
        if (input === null) return;
        const peer =
          input.role === "offerer"
            ? answerHandleRef.current?.peer
            : input.bootstrap.offerer;
        const knownPeer =
          input.role === "answerer"
            ? input.bootstrap.offerer
            : answerHandleRef.current?.peer;
        const peerName = knownPeer?.displayName ?? "";
        const peerSas = knownPeer ? sasFingerprint(knownPeer.ghostId) : "";
        const peerGhostId = knownPeer?.ghostId ?? "";
        switch (state) {
          case "verifying":
            dispatch({ type: "verifying", peerName, peerSas });
            return;
          case "connected":
            dispatch({
              type: "connected",
              peerName,
              peerSas,
              peerGhostId,
            });
            return;
          case "interrupted":
            dispatch({ type: "interrupted" });
            return;
          case "failed":
            dispatch({ type: "failed", message: detail ?? "connection failed" });
            return;
          case "closed":
            dispatch({ type: "closed" });
            return;
        }
        void peer;
      },
      onMessage: (m: ChatMessage) => {
        messagesRef.current = [...messagesRef.current, m];
        setMessages(messagesRef.current);
      },
      onPeerPinned: () => {
        /* handled via state transitions */
      },
    };

    (async () => {
      try {
        if (input.role === "offerer") {
          const handle = await beginOffererCeremony({
            ghost: input.ghost,
            displayName: displayNameFor(input.ghost),
            receiveUrl: RECEIVE_URL,
            events,
          });
          offerHandleRef.current = handle;
          dispatch({
            type: "offerReady",
            url: handle.invitationUrl,
            artifact: handle.invitationArtifact,
            qrFriendly: handle.qrFriendly,
          });
        } else {
          const bootstrap = input.bootstrap;
          dispatch({
            type: "reviewPeer",
            peerName: bootstrap.offerer.displayName,
            peerSas: sasFingerprint(bootstrap.offerer.ghostId),
            peerGhostId: bootstrap.offerer.ghostId,
          });
          const accepted = await new Promise<boolean>((resolve) => {
            acceptRef.current = () => resolve(true);
          });
          if (!accepted) return;

          const handle = await beginAnswererCeremony({
            ghost: input.ghost,
            displayName: displayNameFor(input.ghost),
            offerBootstrap: bootstrap,
            receiveUrl: RECEIVE_URL,
            events,
          });
          answerHandleRef.current = handle;
          dispatch({
            type: "answerReady",
            url: handle.invitationUrl,
            artifact: handle.invitationArtifact,
            qrFriendly: handle.qrFriendly,
            peerName: bootstrap.offerer.displayName,
            peerSas: sasFingerprint(bootstrap.offerer.ghostId),
          });
          const connection = await handle.connectionPromise;
          connectionRef.current = connection;
        }
      } catch (err) {
        dispatch({
          type: "failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      offerHandleRef.current?.cancel();
      answerHandleRef.current?.cancel();
      connectionRef.current?.close("component unmounted");
    };
  }, [input]);

  return {
    phase,
    messages,
    ownGhostId: input?.ghost.id ?? "",
    send: (text) => {
      const conn = connectionRef.current;
      if (conn === null) return { error: "not connected" };
      return conn.send(text);
    },
    accept: () => {
      acceptRef.current?.();
    },
    submitAnswer: (rawArtifact) => {
      const handle = offerHandleRef.current;
      if (handle === null) return;
      dispatch({ type: "connecting" });
      handle
        .submitAnswer(rawArtifact)
        .then(({ connection }) => {
          connectionRef.current = connection;
        })
        .catch((err) => {
          dispatch({
            type: "failed",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    leave: () => {
      connectionRef.current?.close("user left");
      offerHandleRef.current?.cancel();
      answerHandleRef.current?.cancel();
    },
  };
}

function displayNameFor(ghost: Ghost): string {
  const short = ghost.id.replace(/^ghost_\d+_/, "").slice(0, 6);
  return `${OWN_DISPLAY_NAME_PREFIX} ${short}`;
}

function deriveReceiveUrl(): string {
  if (typeof window === "undefined") return "http://localhost:5173/";
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  return url.toString();
}
