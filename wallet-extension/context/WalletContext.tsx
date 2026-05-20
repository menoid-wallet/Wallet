/**
 * WalletContext.tsx
 * Holds decrypted wallet keys in memory.
 * Auto-locks after LOCK_AFTER_MS of inactivity (popup closed / no activity).
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { WalletKeys } from "../crypto/walletCrypto";

const LOCK_AFTER_MS = 5 * 60 * 1000; // 5 minutes

interface WalletContextValue {
  keys: WalletKeys | null;
  noidMode: boolean; // true = show ZK / Menoid-derived keys
  unlock: (keys: WalletKeys) => void;
  lock: () => void;
  toggleNoidMode: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [keys, setKeys] = useState<WalletKeys | null>(null);
  const [noidMode, setNoidMode] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lock = useCallback(() => {
    setKeys(null);
    setNoidMode(false);
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(lock, LOCK_AFTER_MS);
  }, [lock]);

  const unlock = useCallback(
    (k: WalletKeys) => {
      setKeys(k);
      resetTimer();
    },
    [resetTimer]
  );

  // Reset inactivity timer on any user interaction
  useEffect(() => {
    if (!keys) return;
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    const handler = () => resetTimer();
    events.forEach((e) => window.addEventListener(e, handler));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [keys, resetTimer]);

  // Lock when popup loses focus / visibility
  useEffect(() => {
    if (!keys) return;
    const handler = () => {
      if (document.hidden) {
        // Start a short countdown when hidden; lock if not returned in 5 min
        resetTimer();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [keys, resetTimer]);

  // Cleanup on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <WalletContext.Provider
      value={{ keys, noidMode, unlock, lock, toggleNoidMode: () => setNoidMode((v) => !v) }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}