import { useEffect, useState } from 'react'

let locks = 0

/** Keeps the page behind an overlay from scrolling while it is open. */
export function useScrollLock(): void {
  useEffect(() => {
    if (locks++ === 0) document.body.style.overflow = 'hidden'
    return () => {
      if (--locks === 0) document.body.style.overflow = ''
    }
  }, [])
}

export function useKey(handler: (event: KeyboardEvent) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    addEventListener('keydown', handler)
    return () => removeEventListener('keydown', handler)
  })
}

/**
 * Makes a sideways-scrolling strip usable with a mouse: it can be dragged, and `more` says whether
 * anything lies beyond either edge so the caller can offer buttons that `step` to it.
 * Pass the strip's element from a callback ref, and `content` as anything that changes when its children do.
 */
export function useSideScroll(strip: HTMLElement | null, content?: unknown) {
  const [more, setMore] = useState({ back: false, on: false })

  useEffect(() => {
    if (!strip) return
    const measure = () => {
      const back = strip.scrollLeft > 1
      const on = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
      setMore((current) => (current.back === back && current.on === on ? current : { back, on }))
    }

    let drag: { x: number; left: number; moved: boolean } | null = null
    const swallow = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button === 0) drag = { x: event.clientX, left: strip.scrollLeft, moved: false }
    }
    const onMove = (event: PointerEvent) => {
      if (!drag) return
      const dx = event.clientX - drag.x
      if (Math.abs(dx) > 4) drag.moved = true
      if (drag.moved) strip.scrollLeft = drag.left - dx
    }
    const onUp = () => {
      const moved = drag?.moved
      drag = null
      if (!moved) return
      // The click that ends a drag belongs to the drag, not to whatever is under the pointer.
      strip.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => strip.removeEventListener('click', swallow, true))
    }

    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    strip.addEventListener('scroll', measure, { passive: true })
    strip.addEventListener('pointerdown', onDown)
    addEventListener('pointermove', onMove)
    addEventListener('pointerup', onUp)
    measure()
    return () => {
      observer.disconnect()
      strip.removeEventListener('scroll', measure)
      strip.removeEventListener('pointerdown', onDown)
      removeEventListener('pointermove', onMove)
      removeEventListener('pointerup', onUp)
    }
  }, [strip, content])

  const step = (direction: 1 | -1) => strip?.scrollBy({ left: direction * strip.clientWidth * 0.8, behavior: 'smooth' })
  return { more, step }
}

/** Removes an image that opens the article body, since the reader already shows it as the hero. */
export function dropLeadImage(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const image = doc.body.querySelector('img')
  if (!image) return html
  const before = doc.createRange()
  before.setStart(doc.body, 0)
  before.setEndBefore(image)
  if (before.toString().trim().length < 80) (image.closest('figure') ?? image).remove()
  return doc.body.innerHTML
}
