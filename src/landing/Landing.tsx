import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '../content/supabase'
import { authRedirect, pendingJoinCode, useAccount } from '../content/useAccount'
import { Builder } from './Builder'
import './landing.css'

const STEPS = [
  {
    n: '01',
    title: 'A room for each chapter',
    text: 'How you met, your wedding, what came after. Photos become framed, spotlit prints; films play on screens in the walls.',
  },
  {
    n: '02',
    title: 'Tell the story',
    text: 'Give each moment a title, a date and a caption. Attach a voice note that plays as you walk up.',
  },
  {
    n: '03',
    title: 'Open the doors',
    text: 'Start on the plaza outside, swing open the front doors and walk your story room by room. Headphones on.',
  },
]

export function Landing() {
  return (
    <div className="landing">
      <nav className="nav">
        <span className="brand">
          Our Story <span className="brand-sub">a museum for two</span>
        </span>
        <Link to="/museum?demo" className="nav-link">
          Walk the demo
        </Link>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A private museum for two</p>
          <h1>
            Walk through <em>your love story.</em>
          </h1>
          <p className="lede">
            Upload your photos, films and voice notes. We frame them, light them and hang them in a museum of your own,
            one room for each chapter, that you can walk through right in your browser.
          </p>
          <div className="cta-row">
            <a href="#build" className="btn btn-primary">
              Build your museum
            </a>
            <Link to="/museum?demo" className="btn btn-ghost">
              Walk the demo →
            </Link>
          </div>
        </div>
        <figure className="hero-art">
          <img src="/hero-museum.jpg" alt="The museum's modern concrete front at dusk: brass lettering, a glowing glass entrance under a thin canopy, and reflecting pools" />
          <figcaption>Rendered live in your browser</figcaption>
        </figure>
      </header>

      <section className="steps" aria-label="How it works">
        {STEPS.map((s) => (
          <article key={s.n} className="step">
            <span className="step-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </article>
        ))}
      </section>

      <BuilderSection />

      <footer className="footer">Made with love · Your memories are private to the two of you.</footer>
    </div>
  )
}

/** Signed in → the couple's shared museum; no Supabase configured → this device only. */
function BuilderSection() {
  const account = useAccount()
  const signOut = () => void supabase?.auth.signOut()

  // Back from a sign-in link (?signin&code=…): once signed in, tidy the address and bring the builder into view
  useEffect(() => {
    if (account.status !== 'ready' || !new URLSearchParams(location.search).has(SIGNIN_PARAM)) return
    history.replaceState(null, '', `${location.pathname}#build`)
    document.getElementById('build')?.scrollIntoView({ behavior: 'smooth' })
  }, [account.status])

  switch (account.status) {
    case 'local':
      return <Builder repo={account.repo} />
    case 'loading':
      return <section id="build" className="builder builder--loading" />
    case 'signed-out':
      return <SignIn />
    case 'error':
      return (
        <section id="build" className="builder">
          <div className="signin">
            <h2>Something went wrong</h2>
            <p className="error">{account.message}</p>
            <button className="btn btn-ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        </section>
      )
    case 'ready':
      return (
        <Builder
          repo={account.repo}
          cloud={{ museum: account.museum, email: account.session.user.email ?? '', onSignOut: signOut }}
        />
      )
  }
}

const SIGNIN_PARAM = 'signin'

/** An error Supabase sent back with the sign-in link (expired, already used, …). */
function linkError() {
  const q = new URLSearchParams(location.search)
  const h = new URLSearchParams(location.hash.replace(/^#/, ''))
  const msg = q.get('error_description') ?? h.get('error_description')
  return msg ? `That sign-in link didn't work (${msg.replace(/\+/g, ' ')}). Send a new one, or type the code from the email.` : null
}

function SignIn() {
  const invited = Boolean(pendingJoinCode())
  // Someone opening an invite is most likely new here
  const [kind, setKind] = useState<'signin' | 'signup' | 'link'>(invited ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(linkError)

  // Arriving from an invite link: go straight to the form
  useEffect(() => {
    if (invited) document.getElementById('build')?.scrollIntoView({ behavior: 'smooth' })
  }, [invited])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNote(null)
    setBusy(true)
    const auth = supabase!.auth
    const address = email.trim()
    if (kind === 'signin') {
      const { error } = await auth.signInWithPassword({ email: address, password })
      if (error)
        setError(
          error.message === 'Invalid login credentials'
            ? 'Wrong email or password. New here? Create an account below.'
            : error.message,
        )
    } else if (kind === 'signup') {
      const { data, error } = await auth.signUp({ email: address, password, options: { emailRedirectTo: authRedirect(SIGNIN_PARAM) } })
      if (error) setError(error.message)
      // Email confirmation still switched on in Supabase: the account waits for the link
      else if (!data.session) setNote(`Account created. Confirm it with the link we sent to ${address}, then sign in here.`)
    } else {
      const { error } = await auth.signInWithOtp({ email: address, options: { emailRedirectTo: authRedirect(SIGNIN_PARAM) } })
      if (error) setError(error.message)
      else setNote(`We sent a sign-in link to ${address}. Open it in this same browser.`)
    }
    setBusy(false)
  }

  const label = { signin: 'Sign in', signup: 'Create account', link: 'Email me a link' }[kind]
  return (
    <section id="build" className="builder">
      <div className="signin">
        <p className="eyebrow">{invited ? "You're invited" : 'Build your museum'}</p>
        <h2>{invited ? 'Join your partner’s museum' : kind === 'signup' ? 'Create your account' : 'Sign in'}</h2>
        <p className="lede">
          {invited
            ? 'Create your account (or sign in) and you’ll both see, edit and walk through the same museum.'
            : 'Your museum is saved to your account, so it opens on any phone or computer, and you can invite your partner to build it with you.'}
        </p>
        <form className="signin-form signin-form--stack" onSubmit={submit}>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
          />
          {kind !== 'link' && (
            <input
              type="password"
              required
              minLength={6}
              autoComplete={kind === 'signup' ? 'new-password' : 'current-password'}
              placeholder={kind === 'signup' ? 'Choose a password (6+ characters)' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
            />
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'One moment…' : label}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {note && <p className="lede">{note}</p>}
        <p className="signin-switch">
          {kind !== 'signin' && (
            <button type="button" className="link-btn" onClick={() => setKind('signin')}>
              I have an account
            </button>
          )}
          {kind !== 'signup' && (
            <button type="button" className="link-btn" onClick={() => setKind('signup')}>
              New here? Create an account
            </button>
          )}
          {kind !== 'link' && (
            <button type="button" className="link-btn" onClick={() => setKind('link')}>
              Email me a link instead
            </button>
          )}
        </p>
      </div>
    </section>
  )
}
