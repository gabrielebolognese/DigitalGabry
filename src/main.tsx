import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickCapture from "./capture/QuickCapture";
import "./styles/tokens.css";
import "./styles/global.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root container is missing from index.html");
}

/* A query parameter rather than a path, because a path route would need the
   dev server and the production asset protocol to agree on SPA fallback. No
   router: SPEC section 2 fixes the stack and one is not in it. */
const isCapture =
  new URLSearchParams(window.location.search).get("window") === "capture";

ReactDOM.createRoot(container).render(
  <React.StrictMode>{isCapture ? <QuickCapture /> : <App />}</React.StrictMode>,
);
