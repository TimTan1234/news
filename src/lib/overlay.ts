import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type Overlay = 'read' | 'story'

/** Reader and story viewer live in the query string so the back button closes them. */
export function useOverlay() {
  const navigate = useNavigate()
  const location = useLocation()

  const open = useCallback(
    (kind: Overlay, id: number) => {
      const search = new URLSearchParams(location.search)
      search.set(kind, String(id))
      navigate({ search: search.toString() }, { state: { overlay: true } })
    },
    [navigate, location.search],
  )

  const close = useCallback(
    (kind: Overlay) => {
      if ((location.state as { overlay?: boolean } | null)?.overlay) {
        navigate(-1)
        return
      }
      const search = new URLSearchParams(location.search)
      search.delete(kind)
      navigate({ search: search.toString() }, { replace: true })
    },
    [navigate, location.search, location.state],
  )

  return { open, close }
}

export async function share(title: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ title, url })
      return 'shared'
    }
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'shared' : 'failed'
  }
}
