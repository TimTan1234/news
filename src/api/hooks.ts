import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery, type UseInfiniteQueryResult } from '@tanstack/react-query'
import {
  api,
  today,
  type ActivityHit,
  type Article,
  type BriefingResult,
  type StoredSummary,
  type FeedPage,
  type FeedParams,
  type SearchProvider,
  type Source,
  type Stats,
  type Story,
  type Topic,
  type Tracker,
  type Trend,
} from './client.ts'
import { useLang } from '../i18n/index.ts'
import { queryClient } from './query.ts'

function feedUrl(params: FeedParams, cursor: string | null, limit: number): string {
  const search = new URLSearchParams({ limit: String(limit) })
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  if (cursor) search.set('cursor', cursor)
  return `/api/feed?${search}`
}

/** `scope` separates the home feed from the saved/liked library so each can be refreshed on its own. */
export function useFeed(params: FeedParams, { limit = 20, enabled = true } = {}) {
  const scope = params.filter ? 'library' : 'feed'
  return useInfiniteQuery({
    queryKey: [scope, params, limit],
    queryFn: ({ pageParam }) => api<FeedPage>(feedUrl(params, pageParam, limit)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

/** Loads the next page when the returned element scrolls near the viewport. */
export function useLoadMore(query: Pick<UseInfiniteQueryResult, 'hasNextPage' | 'isFetchingNextPage' | 'fetchNextPage'>) {
  const ref = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    const element = ref.current
    if (!element || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void fetchNextPage()
      },
      { rootMargin: '900px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  return ref
}

export const useStories = () => useQuery({ queryKey: ['stories'], queryFn: () => api<Story[]>('/api/stories') })
export const useTopics = () => useQuery({ queryKey: ['topics'], queryFn: () => api<Topic[]>('/api/topics') })
export const useSources = () => useQuery({ queryKey: ['sources'], queryFn: () => api<Source[]>('/api/sources') })
export const useTrackers = () => useQuery({ queryKey: ['trackers'], queryFn: () => api<Tracker[]>('/api/trackers') })
export const useTrending = () => useQuery({ queryKey: ['trending'], queryFn: () => api<Trend[]>('/api/trending') })
export const useActivity = () => useQuery({ queryKey: ['activity'], queryFn: () => api<ActivityHit[]>('/api/activity') })
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>(`/api/stats?day=${today()}`) })

export const useActivityCount = () =>
  useQuery({
    queryKey: ['activity', 'count'],
    queryFn: () => api<{ unseen: number }>('/api/activity/count'),
    refetchInterval: 120_000,
  })

export const useArticle = (id: number) =>
  useQuery({
    queryKey: ['article', id],
    queryFn: () => api<{ article: Article; summary: StoredSummary | null }>(`/api/articles/${id}`),
  })

export const useProviders = () =>
  useQuery({ queryKey: ['providers'], queryFn: () => api<SearchProvider[]>('/api/search/providers'), staleTime: Infinity })

/** Results from one outside search; they are stored for the account, so they open in the reader like any story. */
export const useWebSearch = (provider: string | null, query: string) =>
  useQuery({
    queryKey: ['web-search', provider, query],
    queryFn: () => api<{ items: Article[] }>(`/api/search?provider=${provider}&q=${encodeURIComponent(query)}`),
    enabled: Boolean(provider && query),
    staleTime: 5 * 60_000,
    retry: false,
  })

export const useReader = (id: number) =>
  useQuery({
    queryKey: ['reader', id],
    queryFn: () => api<{ html: string | null }>(`/api/articles/${id}/reader`),
    staleTime: Infinity,
  })

export function useSummary(id: number) {
  const lang = useLang()
  return useMutation({
    mutationKey: ['summary', id, lang],
    mutationFn: () => api<{ bullets: string[] }>(`/api/articles/${id}/summary`, { body: { lang } }),
    onSuccess: ({ bullets }) => {
      queryClient.setQueryData<{ article: Article; summary: StoredSummary | null }>(['article', id], (current) =>
        current ? { ...current, summary: { lang, bullets } } : current,
      )
    },
  })
}

/** Today's briefing in the current language, written on first request. */
export function useBriefing() {
  const lang = useLang()
  return useQuery({
    queryKey: ['briefing', today(), lang],
    queryFn: async () => {
      const stored = await api<BriefingResult>(`/api/briefing?day=${today()}&lang=${lang}`)
      return stored.briefing ? stored : api<BriefingResult>('/api/briefing', { body: { day: today(), lang } })
    },
    staleTime: Infinity,
    retry: false,
  })
}

export function useRefresh() {
  return useMutation({
    mutationFn: () => api<{ added: number; failed: number }>('/api/refresh', { method: 'POST' }),
    onSuccess: () => invalidate('feed', 'stories', 'trending', 'activity', 'trackers', 'sources'),
  })
}

export function invalidate(...keys: string[]): void {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] })
}
