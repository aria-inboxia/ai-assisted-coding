import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "~/app.css";
import "./workbench.css";
import { Workbench } from "./Workbench.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Workbench />
  </StrictMode>,
);
