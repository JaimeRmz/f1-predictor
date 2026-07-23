import { createContext, useContext, useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabaseClient.js";

// ── Anonymous auth, bootstrapped once on app load ────────────────
// Mirrors HealthProvider's shape: a single provider owns the async bootstrap
// and exposes the result via context so any page can read the current user
// without re-running sign-in. On mount we look for an existing session
// (restored from localStorage by supabase-js); if there isn't one, we create
// an anonymous user. Anonymous sign-in returns a real, durable user_id with a
// JWT whose role is `authenticated`, which is what the predictions/snapshots
// RLS policies grant against — so every Supabase call the app makes afterward
// carries that identity.
//
//   status: "loading" – bootstrap in flight, no user yet
//           "ready"    – a session exists, `user`/`userId` are populated
//           "error"    – sign-in failed (offline / auth disabled); user is null

const AuthContext = createContext({ user: null, userId: null, status: "loading" });
// eslint-disable-next-line react-refresh/only-export-components -- context hook co-located with its provider
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Keep context in lockstep with supabase-js's own auth state (token
    // refreshes, sign-in completing, a restored session) rather than only
    // reading it once.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mountedRef.current) return;
      if (session?.user) { setUser(session.user); setStatus("ready"); }
    });

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mountedRef.current) return;
        if (session?.user) {
          setUser(session.user);
          setStatus("ready");
          return;
        }
        // No session yet → create an anonymous user.
        const { data, error } = await supabase.auth.signInAnonymously();
        if (!mountedRef.current) return;
        if (error) { setStatus("error"); return; }
        setUser(data.user);
        setStatus("ready");
      } catch {
        if (mountedRef.current) setStatus("error");
      }
    })();

    return () => { mountedRef.current = false; sub?.subscription?.unsubscribe(); };
  }, []);

  return (
    <AuthContext.Provider value={{ user, userId: user?.id ?? null, status }}>
      {children}
    </AuthContext.Provider>
  );
};
