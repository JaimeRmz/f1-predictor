import { GlassPanel } from "./GlassPanel.jsx";
import "../pages/home.css";

const Panel = ({ title, caption, children, tint }) => (
  <GlassPanel className="hm-panel" tilt={false} tint={tint}>
    <div className="hm-panel-h"><h2>{title}</h2><p>{caption}</p></div>
    <div className="hm-panel-b">{children}</div>
  </GlassPanel>
);

export default Panel;
