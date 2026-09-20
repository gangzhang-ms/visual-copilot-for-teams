import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createHostAdapter } from "../host/host-adapter";
import "./styles.css";

const host = createHostAdapter();
void host.initialize().then((snapshot) => {
  document.documentElement.dataset.theme = snapshot.theme;
  host.onThemeChange((theme) => {
    document.documentElement.dataset.theme = theme;
  });
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
});
