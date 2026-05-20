/**
 * WalletContext.tsx
 * Holds decrypted wallet in memory. Auto-locks after 5min inactivity.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { StoredWallet } from "../crypto/walletCrypto";

const LOCK_AFTER_MS = 5 * 60 * 1000;

interface WalletContextValue {
  wallet: StoredWallet | null;
  noidMode: boolean;
  unlock: (wallet: StoredWallet) => void;
  lock: () => void;
  toggleNoidMode: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<StoredWallet | null>(null);
  const [noidMode, setNoidMode] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lock = useCallback(() => {
    setWallet(null);
    setNoidMode(false);
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(lock, LOCK_AFTER_MS);
  }, [lock]);

  const unlock = useCallback((w: StoredWallet) => {
    setWallet(w);
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!wallet) return;
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    const handler = () => resetTimer();
    events.forEach((e) => window.addEventListener(e, handler));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [wallet, resetTimer]);

  useEffect(() => {
    if (!wallet) return;
    const handler = () => { if (document.hidden) resetTimer(); };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [wallet, resetTimer]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <WalletContext.Provider value={{ wallet, noidMode, unlock, lock, toggleNoidMode: () => setNoidMode(v => !v) }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}