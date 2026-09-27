import { useEffect, type RefObject } from 'react'

/**
 * Task 6 (mobile pass, item B): `.left-column` has scrolled internally
 * since Task 5 (capped at `--board-size`, `overflow-y: auto`) with no
 * visual cue that there is more below it. Measured at 1280x720 with a
 * long game: the Controls card is sliced flat at the column's bottom
 * edge — no border, no radius, no shadow — reading as a broken card
 * rather than a scrollable one (worst in dark mode, where there is no
 * drop-shadow to read the cut by).
 *
 * Sets `data-fade-bottom` on the element only while there is genuinely
 * more content below the CURRENT scroll position (see the mask-image rule
 * this drives, in app.css's `.left-column` block) — not merely because
 * the column CAN scroll. It disappears once the reader actually reaches
 * the end, which is the same convention native scrollbars and most
 * scroll-shadow implementations use: the affordance promises there is
 * more, and stops promising once that stops being true.
 *
 * `ResizeObserver` targets the column's own CHILDREN, not the column
 * itself: `.left-column`'s own box is height-capped
 * (`max-height: var(--board-size)`), so its rendered size never changes
 * when a child grows internally — the Captured card widening as material
 * comes off, the Controls card's reserved hint-text filling in — only
 * `scrollHeight` does, and `ResizeObserver` has no way to see that on a
 * capped parent. Observing the (small, fixed-count) children directly is
 * what catches those without polling.
 */
export function useOverflowFade(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      const moreBelow = el.scrollTop + el.clientHeight < el.scrollHeight - 1
      el.toggleAttribute('data-fade-bottom', moreBelow)
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)

    const ro = new ResizeObserver(update)
    for (const child of el.children) ro.observe(child)

    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      ro.disconnect()
    }
  }, [ref])
}
