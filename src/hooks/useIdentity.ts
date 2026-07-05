import { useEffect, useState } from "react";

import { getIdentity, type LocalIdentity } from "../identity/store";

type State =
  | { status: "loading" }
  | { status: "ready"; identity: LocalIdentity }
  | { status: "unsupported"; message: string };

/**
 * Load this browser's Ghost identity once. Cached inside getIdentity()
 * so multiple mounts share the same promise.
 */
export function useIdentity(): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const identity = await getIdentity();
        if (!cancelled) setState({ status: "ready", identity });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "unsupported",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
