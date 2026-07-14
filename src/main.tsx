import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./ui/App";
import { initAnalytics } from "./analytics";
import "./ui/globals.css";

// Fire PostHog init before the first render. No-op when the env var
// is unset (open-source forks, dev without a project token).
initAnalytics();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("no #root");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
