import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined

/** null when the project isn't configured — the app then runs in this-device-only mode. */
export const supabase =
  url && key
    ? createClient(url, key, {
        // Sign-in links come back as ?code=… (not in the #fragment, which the page uses for #build)
        auth: { flowType: 'pkce', detectSessionInUrl: true },
      })
    : null

export const MEDIA_BUCKET = 'museum-media'
