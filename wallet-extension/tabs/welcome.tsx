import menoImg from "data-base64:~assets/meno/meno_hi_text.png"

import "../style.css"

function Welcome() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-cream font-body text-ink selection:bg-ink selection:text-cream">
      <Backdrop />

      {/* ─── top chrome ─── */}
      <header className="absolute inset-x-0 top-0 z-40">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-10 py-5">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-goldDeep" />
            <span className="font-display text-[13px] font-semibold tracking-[0.32em] text-ink">
              MENOID
            </span>
          </div>
          <nav className="flex items-center gap-8 text-[10px] tracking-[0.4em] uppercase text-ink/55">
            <span>Est. MMXXVI</span>
            <span className="hidden md:inline">v0.0.1</span>
            <span className="hidden md:inline">Monad</span>
          </nav>
        </div>
        <div className="mx-auto h-px max-w-[1320px] bg-gradient-to-r from-transparent via-ink/15 to-transparent" />
      </header>

      {/* ─── main ─── */}
      <main className="relative z-10 mx-auto flex h-full max-w-[1320px] items-center px-10 pt-20 pb-28">
        <div className="grid h-full w-full grid-cols-1 md:grid-cols-12 items-center gap-10">
          {/* ── left column ── */}
          <div className="md:col-span-7 flex flex-col justify-center">

            {/* eyebrow */}
            <div
              className="flex items-center gap-3 animate-revealRight"
              style={{ animationDelay: "0.05s" }}>
              <span className="font-serif italic text-base text-goldDeep">
                01
              </span>
              <span className="h-px w-10 bg-ink/25" />
              <span className="text-[10px] tracking-[0.4em] uppercase text-ink/55">
                The Captain
              </span>
            </div>

            {/* BIG hero headline — Introducing Menoid */}
            <h1
              className="mt-5 font-display font-bold text-ink tracking-[-0.035em] leading-[0.95] text-[clamp(44px,5.6vw,84px)] animate-revealUp"
              style={{ animationDelay: "0.15s" }}>
              Introducing{" "}
              <span className="font-serif italic font-medium text-goldDeep">
                Menoid
              </span>
              <span className="text-ink">.</span>
            </h1>

            {/* tagline */}
            <p
              className="mt-4 max-w-[520px] text-[15px] leading-[1.65] text-ink/60 animate-revealUp"
              style={{ animationDelay: "0.28s" }}>
              An AI-native Private smart wallet on Monad.
            </p>

            {/* meet meno — smaller supporting line */}
            <div
              className="mt-5 flex items-center gap-3 animate-revealRight"
              style={{ animationDelay: "0.36s" }}>
              <span className="h-px w-6 bg-goldDeep/50" />
              <p className="text-[28px] font-bold tracking-[0.05em] text-ink/80">
                Meet{" "}
                <span className="font-serif italic text-goldDeep">Meno</span>
                {" "}— your companion on Menoid.
              </p>
            </div>

            {/* divider */}
            <div
              className="mt-10 mb-8 h-px w-16 bg-goldDeep/60 animate-revealRight"
              style={{ animationDelay: "0.4s" }}
            />

            {/* actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[560px]">
              <SetupCard
                index="01"
                kicker="Fresh start"
                title="Create wallet"
                desc="Generate a new private smart account."
                tone="dark"
                delay="0.5s"
              />
              <SetupCard
                index="02"
                kicker="Returning crew"
                title="Import wallet"
                desc="Restore from a seed phrase or key."
                tone="light"
                delay="0.6s"
              />
            </div>

            {/* trust strip */}
            <div
              className="mt-10 flex items-center gap-5 text-[10px] tracking-[0.35em] uppercase text-ink/45 animate-revealUp"
              style={{ animationDelay: "0.75s" }}>
              <Badge>Non-custodial</Badge>
              <Badge>Zero-knowledge</Badge>
              <Badge>Smart Wallet</Badge>
            </div>
          </div>

          {/* ── hairline divider ── */}
          <div className="hidden md:block md:col-span-1 h-[60%] mx-auto w-px bg-gradient-to-b from-transparent via-ink/15 to-transparent" />

          {/* ── right column: meno stage ── */}
          <div className="md:col-span-4 relative flex h-full items-center justify-center">
            <Stage />
          </div>
        </div>
      </main>

      {/* ─── bottom rail ─── */}
      <footer className="absolute inset-x-0 bottom-0 z-30">
        <div className="mx-auto h-px max-w-[1320px] bg-gradient-to-r from-transparent via-ink/10 to-transparent" />
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-10 py-4 text-[10px] tracking-[0.35em] uppercase text-ink/40">
          <span>© Menoid · AI-native smart wallet</span>
          <span className="hidden md:flex items-center gap-3">
            <span>21°N · 47°W</span>
            <span className="h-1 w-1 rounded-full bg-ink/30" />
            <span>Secure session</span>
          </span>
        </div>
      </footer>
    </div>
  )
}

/* ─── pieces ─── */

function Backdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-br from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_82%_45%,_rgba(232,174,58,0.32)_0%,_rgba(246,233,208,0)_50%)]" />
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-40" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#171311_1px,transparent_1px),linear-gradient(to_bottom,#171311_1px,transparent_1px)] [background-size:72px_72px]" />
    </>
  )
}

function Stage() {
  return (
    <div className="relative flex aspect-square w-full max-w-[320px] items-center justify-center">
      {/* halo */}
      <div className="absolute h-[78%] aspect-square rounded-full bg-gold/35 blur-3xl animate-shimmer" />
      {/* compass rings */}
      <CompassRing
        size={320}
        className="absolute animate-spinSlow opacity-70"
      />
      <CompassRing
        size={260}
        variant="inner"
        className="absolute animate-spinReverse opacity-55"
      />
      <div className="absolute h-[64%] aspect-square rounded-full border border-dashed border-ink/15" />

      {/* meno */}
      <div className="relative animate-float will-change-transform">
        <img
          src={menoImg}
          alt="Meno the pirate"
          style={{ mixBlendMode: "multiply" }}
          className="relative w-[clamp(320px,32vw,460px)] drop-shadow-[0_36px_30px_rgba(28,20,12,0.3)]"
        />
      </div>

      {/* ground */}
      <div className="absolute bottom-[16%] h-2.5 w-[30%] rounded-full bg-ink/25 blur-md animate-shimmer" />

      {/* stamp */}
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-3">
        <span className="h-px w-6 bg-goldDeep/60" />
        <p className="font-serif italic text-[13px] leading-none text-ink/60">
          Yer keys, yer kingdom.
        </p>
        <span className="h-px w-6 bg-goldDeep/60" />
      </div>
    </div>
  )
}

function CompassRing({
  size,
  className = "",
  variant = "outer"
}: {
  size: number
  className?: string
  variant?: "outer" | "inner"
}) {
  const r = size / 2 - 4
  const ticks = Array.from({ length: variant === "outer" ? 60 : 36 })
  const labels = ["N", "E", "S", "W"]
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#171311"
        strokeOpacity={variant === "outer" ? 0.14 : 0.1}
        strokeWidth="1"
      />
      {ticks.map((_, i) => {
        const angle = (i / ticks.length) * 360
        const isMajor = i % (variant === "outer" ? 5 : 3) === 0
        const len = isMajor ? 8 : 3
        return (
          <line
            key={i}
            x1={size / 2}
            y1={4}
            x2={size / 2}
            y2={4 + len}
            stroke="#171311"
            strokeOpacity={isMajor ? 0.5 : 0.22}
            strokeWidth={isMajor ? 1.1 : 0.6}
            transform={`rotate(${angle} ${size / 2} ${size / 2})`}
          />
        )
      })}
      {variant === "outer" &&
        labels.map((l, i) => {
          const angle = i * 90
          const rad = ((angle - 90) * Math.PI) / 180
          const x = size / 2 + Math.cos(rad) * (r - 20)
          const y = size / 2 + Math.sin(rad) * (r - 20)
          return (
            <text
              key={l}
              x={x}
              y={y}
              fill="#A36E14"
              fontSize="10"
              fontFamily="Fraunces, serif"
              fontStyle="italic"
              textAnchor="middle"
              dominantBaseline="middle">
              {l}
            </text>
          )
        })}
    </svg>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1 w-1 rounded-full bg-goldDeep/70" />
      <span>{children}</span>
    </span>
  )
}

function SetupCard({
  index,
  kicker,
  title,
  desc,
  tone,
  delay
}: {
  index: string
  kicker: string
  title: string
  desc: string
  tone: "dark" | "light"
  delay: string
}) {
  const isDark = tone === "dark"
  return (
    <button
      style={{ animationDelay: delay }}
      className={`group relative overflow-hidden rounded-2xl p-5 text-left transition-all duration-500 hover:-translate-y-[3px] animate-revealUp
        ${
          isDark
            ? "bg-ink text-bone shadow-[0_18px_36px_-18px_rgba(23,19,17,0.6)] hover:shadow-[0_24px_48px_-18px_rgba(23,19,17,0.7)]"
            : "bg-bone text-ink border border-ink/10 shadow-[0_12px_28px_-18px_rgba(23,19,17,0.35)] hover:border-goldDeep/50"
        }`}

      onClick={() => {
        window.location.href = chrome.runtime.getURL("popup.html")
      }}>
      {/* hover sheen */}
      <div
        className={`pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition duration-500
          ${
            isDark
              ? "bg-[radial-gradient(circle_at_85%_15%,_rgba(232,174,58,0.4),transparent_60%)]"
              : "bg-[radial-gradient(circle_at_15%_15%,_rgba(232,174,58,0.28),transparent_60%)]"
          }`}
      />

      {/* top row */}
      <div className="relative flex items-center justify-between">
        <span
          className={`font-serif italic text-base ${
            isDark ? "text-gold" : "text-goldDeep"
          }`}>
          {index}
        </span>
        <CardGlyph isDark={isDark} kind={index === "01" ? "plus" : "import"} />
      </div>

      {/* body */}
      <div className="relative mt-7">
        <p
          className={`text-[9px] tracking-[0.4em] uppercase ${
            isDark ? "text-gold/80" : "text-goldDeep"
          }`}>
          {kicker}
        </p>
        <h3 className="mt-1.5 font-display text-[22px] font-semibold tracking-[-0.015em] leading-tight">
          {title}
        </h3>
        <p
          className={`mt-1.5 text-[13px] leading-[1.5] ${
            isDark ? "text-bone/65" : "text-ink/65"
          }`}>
          {desc}
        </p>
      </div>

      {/* action */}
      <div className="relative mt-6 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[10px] tracking-[0.35em] uppercase">
          <span className="relative">
            Begin
            <span
              className={`absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100 ${
                isDark ? "bg-gold" : "bg-goldDeep"
              }`}
            />
          </span>
          <svg
            width="22"
            height="9"
            viewBox="0 0 22 9"
            fill="none"
            className="transition group-hover:translate-x-1.5">
            <path
              d="M0 4.5H20M20 4.5L16.5 1M20 4.5L16.5 8"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isDark ? "bg-gold/60" : "bg-goldDeep/60"
          }`}
        />
      </div>
    </button>
  )
}

function CardGlyph({
  isDark,
  kind
}: {
  isDark: boolean
  kind: "plus" | "import"
}) {
  const stroke = isDark ? "#E8AE3A" : "#A36E14"
  return (
    <div
      className={`flex h-9 w-9 items-center justify-center rounded-full ${
        isDark ? "bg-bone/5 ring-1 ring-bone/15" : "bg-ink/[0.04] ring-1 ring-ink/10"
      }`}>
      {kind === "plus" ? (
        <svg width="12" height="12" viewBox="0 0 18 18" fill="none">
          <path
            d="M9 0V18M0 9H18"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="14" height="12" viewBox="0 0 20 18" fill="none">
          <path
            d="M19 9H7M7 9L11 5M7 9L11 13M1 1V17"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  )
}

export default Welcome