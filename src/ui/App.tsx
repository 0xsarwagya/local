import { useEffect, useState } from "react";

import { Home } from "./Home";
import { Session } from "./Session";
import { readIncomingBootstrap } from "../peer/inbox";
import type { OfferBootstrap } from "../peer/bootstrap";

export type AppState =
  | { view: "home" }
  | { view: "inviting" }
  | { view: "joining"; bootstrap: OfferBootstrap };

export function App() {
  const [state, setState] = useState<AppState>({ view: "home" });

  useEffect(() => {
    // If the page was opened via a handoff link, jump straight into
    // the join flow after showing an explicit confirmation card.
    (async () => {
      const incoming = await readIncomingBootstrap();
      if (incoming) setState({ view: "joining", bootstrap: incoming });
    })();
  }, []);

  const back = () => setState({ view: "home" });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-5 py-8 sm:px-6 md:py-12">
      {state.view === "home" ? (
        <Home onStart={() => setState({ view: "inviting" })} />
      ) : null}

      {state.view === "inviting" ? <Session role="offerer" onLeave={back} /> : null}

      {state.view === "joining" ? (
        <Session role="answerer" bootstrap={state.bootstrap} onLeave={back} />
      ) : null}
    </main>
  );
}
