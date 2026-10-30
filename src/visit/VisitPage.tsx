import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { openVisit } from '../content/useAccount'
import { supabase } from '../content/supabase'

/**
 * /visit/:code — the link (or QR code) the couple shares: no sign-in, straight
 * into the museum. The browser is signed in anonymously as a read-only guest.
 */
export function VisitPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(supabase ? null : 'This museum isn’t online yet.')

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    openVisit(code)
      .then(() => !cancelled && navigate('/museum', { replace: true }))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [code, navigate])

  return (
    <div className="museum-loading">
      {error ? (
        <div className="visit-error">
          <p>Couldn’t open the museum: {error}</p>
          <Link to="/">Go to the home page</Link>
        </div>
      ) : (
        'Opening your museum…'
      )}
    </div>
  )
}
