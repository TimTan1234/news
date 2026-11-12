import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { queryClient } from './api/query.ts'
import { Reader } from './components/Reader.tsx'
import { Shell } from './components/Shell.tsx'
import { StoryViewer } from './components/Stories.tsx'
import { Toaster } from './components/ui.tsx'
import { Activity } from './pages/Activity.tsx'
import { Auth } from './pages/Auth.tsx'
import { Briefing } from './pages/Briefing.tsx'
import { Explore } from './pages/Explore.tsx'
import { Home, SourcePage } from './pages/Home.tsx'
import { Profile } from './pages/Profile.tsx'
import { Settings } from './pages/Settings.tsx'
import { sessionStore } from './state/session.ts'
import { useStore } from './state/store.ts'

function Overlays() {
  const [search] = useSearchParams()
  const story = Number(search.get('story'))
  const read = Number(search.get('read'))
  return (
    <>
      {story > 0 && <StoryViewer key={story} sourceId={story} />}
      {read > 0 && <Reader key={read} id={read} />}
    </>
  )
}

/** The gradient that the wordmark and story rings stroke with. */
function AccentStroke() {
  return (
    <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
      <linearGradient id="accent-stroke" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--accent-a)' }} />
        <stop offset="1" style={{ stopColor: 'var(--accent-b)' }} />
      </linearGradient>
    </svg>
  )
}

export function App() {
  const session = useStore(sessionStore)
  if (session.status === 'loading') return null
  if (session.status === 'out') {
    return (
      <>
        <Auth />
        <Toaster />
        <AccentStroke />
      </>
    )
  }
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="source/:id" element={<SourcePage />} />
            <Route path="explore" element={<Explore />} />
            <Route path="briefing" element={<Briefing />} />
            <Route path="activity" element={<Activity />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
        <Overlays />
        <Toaster />
        <AccentStroke />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
