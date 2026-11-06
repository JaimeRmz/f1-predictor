import { useCallback, useState } from "react";

const KEY = "f1.orderMode";
export const ORDER_MODES = ["gap", "int"];

const read = () => {
  try { const v = window.localStorage.getItem(KEY); return ORDER_MODES.includes(v) ? v : "gap"; } catch { return "gap"; }
};

/** The order board's GAP / INT choice, remembered per viewer. localStorage can be missing or throw: the board then just starts on GAP. */
export const useOrderMode = () => {
  const [mode, set] = useState(read);
  const setMode = useCallback((m) => {
    if (!ORDER_MODES.includes(m)) return;
    set(m);
    try { window.localStorage.setItem(KEY, m); } catch { /* private window or blocked storage: the choice just is not remembered */ }
  }, []);
  return [mode, setMode];
};
