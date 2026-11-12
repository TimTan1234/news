import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery, type UseInfiniteQueryResult } from '@tanstack/react-query'
import {
  api,
  today,
  type ActivityHit,
  type Article,
  type BriefingResult,
  type FeedPage,
  type FeedParams,
  type Source,
  type Stats,
  type Story,
  type Topic,
  type Tracker,
  type Trend,
} from './client.ts'
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
    queryFn: () => api<{ article: Article; summary: string[] | null }>(`/api/articles/${id}`),
  })

export const useReader = (id: number) =>
  useQuery({
    queryKey: ['reader', id],
    queryFn: () => api<{ html: string | null }>(`/api/articles/${id}/reader`),
    staleTime: Infinity,
  })

export function useSummary(id: number) {
  return useMutation({
    mutationKey: ['summary', id],
    mutationFn: () => api<{ bullets: string[] }>(`/api/articles/${id}/summary`, { method: 'POST' }),
    onSuccess: ({ bullets }) => {
      queryClient.setQueryData<{ article: Article; summary: string[] | null }>(['article', id], (current) =>
        current ? { ...current, summary: bullets } : current,
      )
    },
  })
}

export const useBriefing = () =>
  useQuery({
    queryKey: ['briefing', today()],
    queryFn: async () => {
      const stored = await api<BriefingResult>(`/api/briefing?day=${today()}`)
      return stored.briefing ? stored : api<BriefingResult>('/api/briefing', { body: { day: today() } })
    },
    staleTime: Infinity,
    retry: false,
  })

export function useRefresh() {
  return useMutation({
    mutationFn: () => api<{ added: number; failed: number }>('/api/refresh', { method: 'POST' }),
    onSuccess: () => invalidate('feed', 'stories', 'trending', 'activity', 'trackers', 'sources'),
  })
}

export function invalidate(...keys: string[]): void {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] })
}
