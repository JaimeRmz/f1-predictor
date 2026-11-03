// Entry for the Stage 2 design previews (design-a.html, design-b.html, design-c.html).
// The live app (index.html -> src/main.jsx) is untouched. Previews call no API: all data is committed JSON.
import { createRoot } from "react-dom/client";
import "../index.css";
import "./previews.css";

const design = document.body.dataset.design;
const loaders = { a: () => import("./DesignA.jsx"), b: () => import("./DesignB.jsx"), c: () => import("./DesignC.jsx") };
loaders[design]().then(({ default: Design }) => {
  createRoot(document.getElementById("root")).render(<Design />);
});
