import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import './index.css'
import { Landing } from './landing/Landing'
import { VisitPage } from './visit/VisitPage'

// The 3D museum (three.js, physics, post-processing) is a big chunk — only load it when entering
const MuseumPage = lazy(() => import('./museum/MuseumPage'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/visit/:code" element={<VisitPage />} />
        <Route
          path="/museum"
          element={
            <Suspense fallback={<div className="museum-loading">Opening the museum…</div>}>
              <MuseumPage />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
