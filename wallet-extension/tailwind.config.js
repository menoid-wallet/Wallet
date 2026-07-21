/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./popup.tsx",
    "./tabs/**/*.{js,ts,jsx,tsx}",
    "./contents/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      /* Every whole percent, not Tailwind's default 5% ladder.
         `text-white/68` is not on that ladder, so the class was never
         generated and the copy fell back to the UA default — black type on a
         purple sky. Same for /72, /78, /12. Rather than snapping every call
         site to a multiple of five, make the whole range real. */
      opacity: Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => [i, String(i / 100)])
      ),
      colors: {
        cream: "#F4E7CC",
        parchment: "#EAD5A7",
        ink: "#171311",
        inkSoft: "#2A211C",
        bone: "#FAF5E9",
        gold: "#E8AE3A",
        goldDeep: "#A36E14",
        goldLight: "#F4D27A",
        rust: "#8E2F1B",
        cocoa: "#5C3A21",

        /* ── Menoid purple — the brand palette, shared with the website.
              Surfaces are sampled from the backdrop artwork, the mark
              colours from the logo itself. ── */
        violetDeep: "#4E2F8E",
        violetDark: "#7F63C7",
        violet: "#8D6DCC",
        violetMid: "#AE8FE2",
        violetSoft: "#C3B1F1",
        lilac: "#D9BEF4",
        lilacPale: "#EDC8FD",
        creamViolet: "#F0E9FE",
        logoFace: "#DFCBFF",
        logoMid: "#CDB3FF",
        logoLine: "#9F7DF9",
        logoInk: "#835FE6"
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "ui-sans-serif", "system-ui"],
        serif: ["'Fraunces'", "ui-serif", "Georgia", "serif"],
        body: ["'Plus Jakarta Sans'", "ui-sans-serif", "system-ui"],
        round: ["'Fredoka'", "ui-rounded", "'SF Pro Rounded'", "system-ui"]
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0) rotate(-1deg)" },
          "50%": { transform: "translateY(-22px) rotate(1.5deg)" }
        },
        shimmer: {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "0.9", transform: "scale(1.06)" }
        },
        bob: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(6px)" }
        },
        sway: {
          "0%, 100%": { transform: "rotate(-3deg)" },
          "50%": { transform: "rotate(3deg)" }
        },
        revealUp: {
          "0%": { opacity: "0", transform: "translateY(28px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        revealRight: {
          "0%": { opacity: "0", transform: "translateX(-18px)" },
          "100%": { opacity: "1", transform: "translateX(0)" }
        },
        spinSlow: {
          to: { transform: "rotate(360deg)" }
        },
        spinReverse: {
          to: { transform: "rotate(-360deg)" }
        },
        drawLine: {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" }
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" }
        }
      },
      animation: {
        float: "float 7s ease-in-out infinite",
        shimmer: "shimmer 5s ease-in-out infinite",
        bob: "bob 2.5s ease-in-out infinite",
        sway: "sway 4s ease-in-out infinite",
        revealUp: "revealUp 0.9s cubic-bezier(0.22,1,0.36,1) both",
        revealRight: "revealRight 0.9s cubic-bezier(0.22,1,0.36,1) both",
        spinSlow: "spinSlow 60s linear infinite",
        spinReverse: "spinReverse 90s linear infinite",
        drawLine: "drawLine 1.2s cubic-bezier(0.22,1,0.36,1) both",
        ticker: "ticker 40s linear infinite"
      }
    }
  },
  plugins: []
}
