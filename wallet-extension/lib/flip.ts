/**
 * flip.ts
 *
 * Minimal FLIP helper (First-Last-Invert-Play). Given an element and a source
 * rect, it snaps the element to where it was (`from`) with no transition, then
 * animates it to its natural position. Used for the shared-element morphs
 * between the token list and the coin page (open ⇄ coin, and the reverse).
 *
 * Returns a cleanup that cancels the post-animation style reset.
 */

const NOOP = () => {}

export function flipFrom(
  el: HTMLElement | null,
  from: DOMRect | null,
  dur = 560,
  easing = "cubic-bezier(0.33, 1.12, 0.5, 1)"
): () => void {
  if (!el || !from || !from.width || !from.height) return NOOP
  const to = el.getBoundingClientRect()
  if (!to.width || !to.height) return NOOP

  const dx = from.left - to.left
  const dy = from.top - to.top
  const sx = from.width / to.width
  const sy = from.height / to.height

  el.style.transformOrigin = "top left"
  el.style.transition = "none"
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
  el.style.willChange = "transform"
  // force the start state to commit before we animate
  void el.getBoundingClientRect()

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.style.transition = `transform ${dur}ms ${easing}`
      el.style.transform = "translate(0px, 0px) scale(1, 1)"
    })
  )

  const t = setTimeout(() => {
    el.style.transition = ""
    el.style.transform = ""
    el.style.willChange = ""
    el.style.transformOrigin = ""
  }, dur + 100)

  return () => clearTimeout(t)
}

/**
 * Reverse card morph: FLIP the card *shell* (background only — no text to
 * squish) out of `from`, and fade the card's content in so it never floats
 * outside the shell while it travels. Mirrors the forward morph's shell+fade.
 */
export function reverseMorphInto(
  shell: HTMLElement | null,
  content: HTMLElement | null,
  from: DOMRect | null,
  dur = 580
): () => void {
  const cancelShell = flipFrom(shell, from, dur)

  let t = 0 as ReturnType<typeof setTimeout> | 0
  if (content && from && from.width) {
    content.style.opacity = "0"
    content.style.transform = "translateY(10px)"
    content.style.willChange = "opacity, transform"
    void content.getBoundingClientRect()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        content.style.transition = `opacity ${dur - 140}ms ease 160ms, transform ${dur - 140}ms ease 160ms`
        content.style.opacity = "1"
        content.style.transform = "translateY(0)"
      })
    )
    t = setTimeout(() => {
      content.style.transition = ""
      content.style.opacity = ""
      content.style.transform = ""
      content.style.willChange = ""
    }, dur + 120)
  }

  return () => {
    cancelShell()
    if (t) clearTimeout(t)
  }
}
