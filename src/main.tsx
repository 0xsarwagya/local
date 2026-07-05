import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./ui/App";
import "./ui/globals.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("no #root");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
