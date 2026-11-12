import { useEffect } from 'react'

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
