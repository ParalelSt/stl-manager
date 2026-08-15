import { App, HostProvider } from "@stl-manager/ui";
import "@stl-manager/ui/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { chooseDirectoryViaDialog, ipcTransport } from "./ipcTransport.js";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("The root element is missing from index.html.");
}

createRoot(container).render(
  <StrictMode>
    <HostProvider host={{ transport: ipcTransport, chooseDirectory: chooseDirectoryViaDialog }}>
      <App />
    </HostProvider>
  </StrictMode>,
);
