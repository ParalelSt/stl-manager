import { App, HostProvider } from "@stl-manager/ui";
import "@stl-manager/ui/index.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHttpTransport } from "../src/httpTransport.js";
import { TokenGate, readStoredToken } from "./TokenGate.js";

function Root() {
  const [token, setToken] = useState<string | undefined>(readStoredToken());

  if (token === undefined) {
    return <TokenGate onAccepted={setToken} />;
  }

  // No chooseDirectory: a browser has no native dialog, so the interface falls
  // back to its own directory picker.
  return (
    <HostProvider host={{ transport: createHttpTransport({ baseUrl: "", token }) }}>
      <App />
    </HostProvider>
  );
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("The root element is missing from index.html.");
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
