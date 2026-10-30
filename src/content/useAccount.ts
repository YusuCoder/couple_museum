import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'

import { cloudRepo, localRepo, resolveCloudMuseum, type CloudMuseum, type Repo } from './repo'
import { supabase } from './supabase'

export type Account =
  | { status: 'loading' }
  /** Supabase not configured: everything stays on this device. */
  | { status: 'local'; repo: Repo }
  | { status: 'signed-out' }
  | { status: 'error'; message: string; session: Session }
  | { status: 'ready'; repo: Repo; session: Session; museum: CloudMuseum }

const JOIN_PARAM = 'join'

/**
 * Invite code from `?join=…`. Kept in localStorage (not sessionStorage) so it
 * survives the email link, which opens in a new tab.
 */
export function pendingJoinCode() {
  const fromUrl = new URLSearchParams(location.search).get(JOIN_PARAM)
  try {
    if (fromUrl) localStorage.setItem(JOIN_PARAM, fromUrl)
    return fromUrl ?? localStorage.getItem(JOIN_PARAM)
  } catch {
    return fromUrl
  }
}

function forgetJoinCode() {
  try {
    localStorage.removeItem(JOIN_PARAM)
  } catch {
    // storage blocked: nothing was kept
  }
}

/** Where an email sign-in link should land: back here, still carrying the invite. */
export function authRedirect(signinParam: string) {
  const code = pendingJoinCode()
  return `${location.origin}/?${signinParam}${code ? `&${JOIN_PARAM}=${encodeURIComponent(code)}` : ''}`
}

export function inviteLink(code: string) {
  return `${location.origin}/?${JOIN_PARAM}=${code}`
}

/** Opens the museum straight away, no account needed (view only). */
export function visitLink(code: string) {
  return `${location.origin}/visit/${code}`
}

/**
 * Open a visit link: sign this browser in anonymously when nobody is signed in,
 * become a guest of that museum, and return its id.
 */
let opening: { code: string; promise: Promise<string> } | null = null
export function openVisit(code: string) {
  // Once at a time: two overlapping calls (React runs effects twice in development) would each make a visitor
  if (opening?.code !== code) opening = { code, promise: visit(code) }
  return opening.promise
}

async function visit(code: string) {
  const auth = supabase!.auth
  const { data } = await auth.getSession()
  if (!data.session) {
    const { error } = await auth.signInAnonymously()
    if (error) throw new Error(error.message)
  }
  const { data: id, error } = await supabase!.rpc('visit_museum', { code })
  if (error) throw new Error(error.message)
  return id as string
}

export function useAccount(): Account {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [account, setAccount] = useState<Account>(supabase ? { status: 'loading' } : { status: 'local', repo: localRepo })

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!supabase || session === undefined) return
    // A visitor from a visit link has no account: here they get the sign-in form like anyone else
    if (!session || session.user.is_anonymous) {
      setAccount({ status: 'signed-out' })
      return
    }
    let cancelled = false
    setAccount({ status: 'loading' })
    const code = pendingJoinCode()
    resolveCloudMuseum(code)
      .then((museum) => {
        if (cancelled) return
        if (code) {
          forgetJoinCode()
          const url = new URL(location.href)
          url.searchParams.delete(JOIN_PARAM)
          history.replaceState(null, '', url)
        }
        setAccount({ status: 'ready', repo: cloudRepo(museum.id), session, museum })
      })
      .catch((e: Error) => {
        if (code) forgetJoinCode()
        if (!cancelled) setAccount({ status: 'error', message: e.message, session })
      })
    return () => {
      cancelled = true
    }
    // Re-resolve only when the signed-in user changes, not on token refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session === undefined])

  return account
}
