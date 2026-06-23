/**
 * ConnectionsView.tsx
 *
 * Shown under Settings → Connected Sites.
 * Lists every stored DappConnection grouped by host.
 * Each row shows:
 *   - Host favicon + domain
 *   - Mode badge (Open / Noid)
 *   - For Noid: "NoidAccount → host"
 *   - Revoke button
 */

import React, { useEffect, useState } from "react"
import {
  readConnections,
  removeConnection,
  type DappConnection,
} from "../lib/connections"

const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"

interface Props {
  isNoid: boolean
  onBack: () => void
  walletId: string
}

export default function ConnectionsView({ isNoid, onBack, walletId }: Props) {
  const [connections, setConnections] = useState<DappConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const list = await readConnections()
      // Only show connections for the currently active wallet
      setConnections(list.filter((c) => c.walletId === walletId))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function revoke(id: string) {
    setRevoking(id)
    try {
      await removeConnection(id)
      setConnections((prev) => prev.filter((c) => c.id !== id))
    } finally {
      setRevoking(null)
    }
  }

  function truncAddr(a: string) {
    if (!a || a.length < 12) return a
    return `${a.slice(0, 6)}…${a.slice(-4)}`
  }

  const cardStyle: React.CSSProperties = {
    background: isNoid ? "rgba(250,245,233,0.04)" : "rgba(23,19,17,0.03)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: isNoid
      ? "1px solid rgba(250,245,233,0.1)"
      : "1px solid rgba(23,19,17,0.08)",
  }

  return (
    <div className="px-5 pt-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={cardStyle}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M7 1L3 5L7 9"
              stroke={isNoid ? "rgba(250,245,233,0.6)" : "rgba(23,19,17,0.6)"}
              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div>
          <p
            className="text-[9px] tracking-[0.4em] uppercase"
            style={{ color: isNoid ? "rgba(250,245,233,0.4)" : "rgba(23,19,17,0.4)" }}>
            Settings
          </p>
          <p
            className="font-display font-bold text-[16px] leading-tight"
            style={{ color: isNoid ? "rgba(250,245,233,0.9)" : "rgba(23,19,17,0.9)" }}>
            Connected Sites
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div
            className="h-6 w-6 rounded-full border-2 animate-spin"
            style={{
              borderColor: "rgba(232,174,58,0.3)",
              borderTopColor: "#E8AE3A",
            }}
          />
        </div>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <span className="text-3xl mb-3" style={{ opacity: 0.4 }}>🔌</span>
          <p
            className="text-[13px] font-semibold"
            style={{ color: isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.5)" }}>
            No connected sites
          </p>
          <p
            className="text-[11px] mt-1"
            style={{ color: isNoid ? "rgba(250,245,233,0.3)" : "rgba(23,19,17,0.3)" }}>
            Sites you connect to will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {connections.map((conn) => (
            <ConnectionRow
              key={conn.id}
              conn={conn}
              isNoid={isNoid}
              revoking={revoking === conn.id}
              onRevoke={() => revoke(conn.id)}
              truncAddr={truncAddr}
              cardStyle={cardStyle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ConnectionRow({
  conn,
  isNoid,
  revoking,
  onRevoke,
  truncAddr,
  cardStyle,
}: {
  conn: DappConnection
  isNoid: boolean
  revoking: boolean
  onRevoke: () => void
  truncAddr: (a: string) => string
  cardStyle: React.CSSProperties
}) {
  const connectedDate = new Date(conn.connectedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })

  return (
    <div
      className="p-3.5 rounded-2xl"
      style={cardStyle}>
      {/* Top row: favicon + host + mode badge */}
      <div className="flex items-center gap-3">
        <FaviconIcon host={conn.host} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p
              className="text-[13px] font-semibold truncate"
              style={{ color: isNoid ? "rgba(250,245,233,0.9)" : "rgba(23,19,17,0.9)" }}>
              {conn.host}
            </p>
            <span
              className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full tracking-[0.2em] uppercase font-semibold"
              style={
                conn.mode === "noid"
                  ? { background: "rgba(232,174,58,0.15)", color: "#E8AE3A", border: "1px solid rgba(232,174,58,0.3)" }
                  : { background: "rgba(99,102,241,0.12)", color: "rgba(165,180,252,0.9)", border: "1px solid rgba(99,102,241,0.25)" }
              }>
              {conn.mode}
            </span>
          </div>
          <p
            className="text-[10px] mt-0.5 font-mono truncate"
            style={{ color: isNoid ? "rgba(250,245,233,0.4)" : "rgba(23,19,17,0.4)" }}>
            {truncAddr(conn.exposedAddress)}
          </p>
        </div>

        <button
          onClick={onRevoke}
          disabled={revoking}
          className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-40 transition-all"
          title="Revoke"
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "rgb(239,68,68)",
          }}>
          {revoking ? (
            <div className="h-3 w-3 rounded-full border border-current animate-spin" style={{ borderTopColor: "transparent" }} />
          ) : (
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>


      {/* Footer: wallet name + date */}
      <div className="flex items-center justify-between mt-2">
        <p
          className="text-[10px]"
          style={{ color: isNoid ? "rgba(250,245,233,0.3)" : "rgba(23,19,17,0.3)" }}>
          via <span className="font-semibold">{conn.walletName}</span>
        </p>
        <p
          className="text-[10px]"
          style={{ color: isNoid ? "rgba(250,245,233,0.25)" : "rgba(23,19,17,0.25)" }}>
          {connectedDate}
        </p>
      </div>
    </div>
  )
}

function FaviconIcon({ host }: { host: string }) {
  const [error, setError] = useState(false)
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${host}&sz=64`

  if (error) {
    return (
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
        style={{ background: "rgba(232,174,58,0.1)", border: "1px solid rgba(232,174,58,0.2)" }}>
        🌐
      </div>
    )
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      className="h-9 w-9 shrink-0 rounded-xl"
      style={{ border: "1px solid rgba(232,174,58,0.15)" }}
      onError={() => setError(true)}
    />
  )
}