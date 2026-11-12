import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  blobKey,
  emptyMuseum,
  loadMuseum as loadLocalMuseum,
  newRoom,
  type StoredMoment,
  type StoredMuseum,
  type StoredRoom,
} from '../content/db'
import { layoutRoom, roomCapacity } from '../content/layout'
import { formatBytes, preparePhoto, titleFromFilename, videoAspect } from '../content/media'
import { localRepo, type CloudMuseum, type Repo } from '../content/repo'
import { inviteLink, visitLink } from '../content/useAccount'
import type { Exhibit } from '../museum/exhibits'
import type { RoomShape } from '../museum/floorplan'
import { roman } from '../content/roman'

function placeLabel(e: Exhibit, shape: RoomShape): string {
  switch (e.wall) {
    case 'free':
      if (Math.abs(e.x ?? 0) < 0.01 && shape === 'rotunda')
        return (e.z ?? 0) > -3 ? 'In the light · large' : 'Hanging · finale'
      if (e.rotY === 0) return 'Far wall · finale'
      if (Math.abs(e.x ?? 0) < 0.01) return 'Centre wall · large'
      if (shape === 'rotunda') return 'Hanging on wires'
      return (e.x ?? 0) < 0 ? 'Left wall' : 'Right wall'
    case 'intro':
      return 'Entrance screen'
    case 'left':
      return 'Left wall'
    case 'right':
      return 'Right wall'
    case 'panel':
      return 'Centre wall · large'
    case 'end':
      return e.along === 0 ? 'Far wall · finale' : 'Far wall · beside the door'
  }
}
const NO_URLS = { media: new Map<string, string>(), voice: new Map<string, string>() }
const MAX_RECORDING_SECONDS = 120

export interface CloudInfo {
  museum: CloudMuseum
  email: string
  onSignOut: () => void
}

export function Builder({ repo, cloud }: { repo: Repo; cloud?: CloudInfo }) {
  const navigate = useNavigate()
  const [museum, setMuseum] = useState<StoredMuseum | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const urlsRef = useRef(urls)
  useEffect(() => {
    urlsRef.current = urls
  }, [urls])

  /** Moments saved in this browser before signing in (offered for moving into the account). */
  const [localIds, setLocalIds] = useState<string[]>([])
  const skipSave = useRef(true)

  useEffect(() => {
    let cancelled = false
    repo
      .load()
      .then(({ museum: m, urls: loaded }) => {
        if (cancelled) return Object.values(loaded).forEach((u) => URL.revokeObjectURL(u))
        skipSave.current = true
        setUrls(loaded)
        setMuseum(m)
      })
      .catch((e: Error) => !cancelled && setError(`Couldn't load your museum: ${e.message}`))
    // Offer to move moments saved on this device into the account
    if (repo.kind === 'cloud') {
      void loadLocalMuseum()
        .then((m) => !cancelled && setLocalIds(m?.moments.map((x) => x.id) ?? []))
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [repo])

  useEffect(() => () => Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u)), [])

  // Saves run one at a time, in order; typing is debounced for the cloud
  const saveChain = useRef(Promise.resolve())
  const pending = useRef<StoredMuseum | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [saving, setSaving] = useState(false)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const m = pending.current
    pending.current = null
    if (m) {
      setSaving(true)
      saveChain.current = saveChain.current
        .then(() => repo.save(m))
        .catch((e: Error) => setError(`Couldn't save: ${e.message}`))
        .finally(() => setSaving(pending.current !== null))
    }
    return saveChain.current
  }, [repo])

  useEffect(() => {
    if (!museum) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    pending.current = museum
    setSaving(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, repo.kind === 'cloud' ? 600 : 0)
  }, [museum, flush, repo.kind])

  useEffect(() => () => void flush(), [flush])

  // Where each moment will hang, per room
  const placement = useMemo(() => {
    const out = new Map<string, string>()
    const rooms = museum?.rooms ?? []
    rooms.forEach((room, i) => {
      const inRoom = (museum?.moments ?? []).filter((m) => m.roomId === room.id)
      const shape = room.shape ?? 'hall'
      for (const e of layoutRoom(inRoom, NO_URLS, i === rooms.length - 1, shape)) out.set(e.id, placeLabel(e, shape))
    })
    return out
  }, [museum?.moments, museum?.rooms])
  const [addingTo, setAddingTo] = useState<string | null>(null)

  if (!museum) return <section id="build" className="builder builder--loading" />
  const localCount = localIds.filter((id) => !museum.moments.some((m) => m.id === id)).length

  const update = (fn: (m: StoredMuseum) => StoredMuseum) => setMuseum((m) => m && fn(m))
  const patchMoment = (id: string, patch: Partial<StoredMoment>) =>
    update((m) => ({ ...m, moments: m.moments.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))

  const storeBlob = async (key: string, blob: Blob) => {
    const url = await repo.putBlob(key, blob)
    setUrls((u) => {
      if (u[key]) URL.revokeObjectURL(u[key])
      return { ...u, [key]: url }
    })
  }

  /** Big videos are re-encoded to 720p so they fit the upload limit and stream quickly to phones. */
  const compressVideo = async (blob: Blob, name: string) => {
    const { prepareVideo, COMPRESS_OVER_BYTES } = await import('../content/video')
    if (blob.size <= COMPRESS_OVER_BYTES) return blob
    return prepareVideo(blob, (f) => setProgress(`Compressing “${name}”… ${Math.round(f * 100)}%`))
  }

  const dropBlob = async (key: string) => {
    await repo.deleteBlob(key).catch(() => {})
    setUrls((u) => {
      if (!u[key]) return u
      URL.revokeObjectURL(u[key])
      const { [key]: _, ...rest } = u
      return rest
    })
  }

  const addFiles = async (files: File[], roomId: string) => {
    setError(null)
    setAddingTo(roomId)
    for (const file of files) {
      const isImage = file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name)
      const isVideo = file.type.startsWith('video/')
      if (!isImage && !isVideo) {
        setError(`“${file.name}” isn't a photo or a video.`)
        continue
      }
      setBusy((b) => b + 1)
      try {
        const id = crypto.randomUUID()
        setProgress(`Compressing “${file.name}”…`)
        const { blob, aspect } = isImage
          ? await preparePhoto(file)
          : { blob: await compressVideo(file, file.name), aspect: await videoAspect(file) }
        setProgress(`Saving “${file.name}”…`)
        await storeBlob(blobKey.media(id), blob)
        const moment: StoredMoment = {
          id,
          roomId,
          kind: isImage ? 'photo' : 'video',
          title: titleFromFilename(file.name),
          date: '',
          caption: '',
          aspect,
          bytes: blob.size,
          originalBytes: file.size,
        }
        update((m) => ({ ...m, moments: [...m.moments, moment] }))
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy((b) => b - 1)
        setProgress(null)
      }
    }
    setAddingTo(null)
  }

  const removeMoment = async (moment: StoredMoment) => {
    update((m) => ({ ...m, moments: m.moments.filter((x) => x.id !== moment.id) }))
    await repo.removeMoment(moment.id).catch((e: Error) => setError(e.message))
    await dropBlob(blobKey.media(moment.id))
    if (moment.voice) await dropBlob(blobKey.voice(moment.id))
  }

  /** Swap with the previous / next moment in the same room. */
  const moveMoment = (id: string, dir: -1 | 1) =>
    update((m) => {
      const i = m.moments.findIndex((x) => x.id === id)
      if (i < 0) return m
      let j = i + dir
      while (j >= 0 && j < m.moments.length && m.moments[j].roomId !== m.moments[i].roomId) j += dir
      if (j < 0 || j >= m.moments.length) return m
      const moments = [...m.moments]
      ;[moments[i], moments[j]] = [moments[j], moments[i]]
      return { ...m, moments }
    })

  /** Move a moment to another room; it becomes that room's last moment. */
  const setMomentRoom = (id: string, roomId: string) =>
    update((m) => {
      const moment = m.moments.find((x) => x.id === id)
      if (!moment || moment.roomId === roomId) return m
      return { ...m, moments: [...m.moments.filter((x) => x.id !== id), { ...moment, roomId }] }
    })

  const patchRoom = (id: string, patch: Partial<StoredRoom>) =>
    update((m) => ({ ...m, rooms: m.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))

  const addRoom = () => update((m) => ({ ...m, rooms: [...m.rooms, newRoom()] }))

  const moveRoom = (id: string, dir: -1 | 1) =>
    update((m) => {
      const i = m.rooms.findIndex((r) => r.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= m.rooms.length) return m
      const rooms = [...m.rooms]
      ;[rooms[i], rooms[j]] = [rooms[j], rooms[i]]
      return { ...m, rooms }
    })

  /** Remove a room; its moments move to the neighbouring room rather than being deleted. */
  const removeRoom = async (room: StoredRoom) => {
    const i = museum.rooms.findIndex((r) => r.id === room.id)
    const target = museum.rooms[i - 1] ?? museum.rooms[i + 1]
    if (!target) return
    const count = museum.moments.filter((x) => x.roomId === room.id).length
    const name = room.title || `Chapter ${roman(i + 1)}`
    const targetName = target.title || 'the next chapter'
    if (count && !confirm(`Remove “${name}”? Its ${count} ${count === 1 ? 'moment moves' : 'moments move'} to “${targetName}”.`)) return
    update((m) => ({
      ...m,
      rooms: m.rooms.filter((r) => r.id !== room.id),
      moments: m.moments.map((x) => (x.roomId === room.id ? { ...x, roomId: target.id } : x)),
    }))
    await flush()
    await repo.removeRoom(room.id).catch((e: Error) => setError(e.message))
  }

  const setVoice = async (id: string, blob: Blob, name: string) => {
    try {
      await storeBlob(blobKey.voice(id), blob)
      patchMoment(id, { voice: { name } })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const removeVoice = async (id: string) => {
    patchMoment(id, { voice: undefined })
    await dropBlob(blobKey.voice(id))
  }

  const setMusic = async (file: File) => {
    if (!file.type.startsWith('audio/')) return setError(`“${file.name}” isn't an audio file.`)
    setBusy((b) => b + 1)
    try {
      await storeBlob(blobKey.music, file)
      update((m) => ({ ...m, music: { name: file.name } }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy((b) => b - 1)
    }
  }

  const removeMusic = async () => {
    update((m) => ({ ...m, music: undefined }))
    await dropBlob(blobKey.music)
  }

  const clearAll = async () => {
    const where = repo.kind === 'cloud' ? 'your shared museum' : 'this device'
    if (!confirm(`Remove all moments, voice notes and the soundtrack from ${where}?`)) return
    for (const m of museum.moments) await repo.removeMoment(m.id).catch(() => {})
    for (const key of Object.keys(urls)) await dropBlob(key)
    setMuseum({ ...emptyMuseum(), names: museum.names, since: museum.since })
  }

  /** Copy everything saved in this browser into the account (big videos are compressed on the way). */
  const importLocal = async () => {
    setError(null)
    setBusy((b) => b + 1)
    try {
      const { museum: lm, urls: lu } = await localRepo.load()
      Object.values(lu).forEach((u) => URL.revokeObjectURL(u))
      const moved: StoredMoment[] = []
      const failed: string[] = []
      for (const [i, m] of lm.moments.entries()) {
        const name = m.title || `moment ${i + 1}`
        // Already moved on an earlier try
        if (museum.moments.some((x) => x.id === m.id)) continue
        try {
          let media = await localRepo.getBlob(blobKey.media(m.id))
          if (!media) continue
          setProgress(`Moving ${i + 1} of ${lm.moments.length}: “${name}”…`)
          if (m.kind === 'video') media = await compressVideo(media, name)
          await storeBlob(blobKey.media(m.id), media)
          const voice = m.voice && (await localRepo.getBlob(blobKey.voice(m.id)))
          if (voice) await storeBlob(blobKey.voice(m.id), voice)
          moved.push({ ...m, bytes: media.size, voice: voice ? m.voice : undefined })
        } catch (e) {
          failed.push(`“${name}” (${(e as Error).message})`)
        }
      }
      const music = lm.music && (await localRepo.getBlob(blobKey.music))
      if (music) await storeBlob(blobKey.music, music)
      update((m) => {
        // An untouched account has one empty default room — replace it with the device's rooms
        const fresh = m.moments.length === 0 && m.rooms.length === 1 && !m.rooms[0].title.trim()
        const rooms = fresh ? lm.rooms : [...m.rooms, ...lm.rooms.filter((r) => !m.rooms.some((x) => x.id === r.id))]
        return {
          names: m.names || lm.names,
          since: m.since || lm.since,
          music: music ? lm.music : m.music,
          rooms,
          moments: [...m.moments, ...moved.filter((x) => !m.moments.some((y) => y.id === x.id))],
        }
      })
      if (failed.length) setError(`Couldn't move every moment yet (you can try again). Couldn't move ${failed.join('; ')}.`)
    } catch (e) {
      setError(`Couldn't move your moments: ${(e as Error).message}`)
    } finally {
      setBusy((b) => b - 1)
      setProgress(null)
    }
  }

  const enter = async () => {
    await flush()
    navigate('/museum')
  }

  return (
    <section id="build" className="builder">
      <header className="section-head">
        <p className="eyebrow">Build your museum</p>
        <h2>Hang your moments</h2>
        <p className="lede">
          Each chapter of your story is a room, and you walk through them in order. Add photos and films to each room
          in the order you want to see them.{' '}
          {repo.kind === 'cloud'
            ? 'Everything is saved to your shared museum as you go.'
            : 'Everything is saved on this device as you go.'}
        </p>
      </header>

      {cloud && <AccountBar cloud={cloud} />}

      {localCount > 0 && (
        <div className="import-banner">
          <span>
            {busy > 0 && progress
              ? progress
              : `You have ${localCount} ${localCount === 1 ? 'moment' : 'moments'} saved in this browser from before you signed in.`}
          </span>
          <button className="btn btn-primary btn-sm" onClick={importLocal} disabled={busy > 0}>
            {busy > 0 ? 'Moving…' : 'Move them to our museum'}
          </button>
        </div>
      )}

      <div className="builder-grid">
        <div className="panel">
          <h3 className="panel-title">Above the front door</h3>
          <label className="field">
            <span>Your names</span>
            <input
              value={museum.names}
              placeholder="Aziz & Malika"
              onChange={(e) => update((m) => ({ ...m, names: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Together since</span>
            <input
              value={museum.since}
              placeholder="2021"
              inputMode="numeric"
              onChange={(e) => update((m) => ({ ...m, since: e.target.value }))}
            />
          </label>
        </div>

        <div className="panel">
          <h3 className="panel-title">Soundtrack</h3>
          {museum.music && urls[blobKey.music] ? (
            <div className="track">
              <PlayChip src={urls[blobKey.music]} />
              <span className="track-name" title={museum.music.name}>
                {museum.music.name}
              </span>
              <button className="link-btn" onClick={removeMusic}>
                Remove
              </button>
            </div>
          ) : (
            <p className="muted">No song yet. The museum plays soft ambient music until you add one.</p>
          )}
          <FileButton accept="audio/*" onFile={setMusic} className="btn btn-ghost btn-sm">
            {museum.music ? 'Choose another song' : 'Add your song'}
          </FileButton>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="rooms">
        {museum.rooms.map((room, ri) => {
          const isLast = ri === museum.rooms.length - 1
          const inRoom = museum.moments.filter((m) => m.roomId === room.id)
          const capacity = roomCapacity(inRoom, isLast, room.shape ?? 'hall')
          const shown = inRoom.filter((m) => placement.has(m.id)).length
          return (
            <section key={room.id} className="room-block" aria-label={room.title || `Chapter ${roman(ri + 1)}`}>
              <header className="room-head">
                <span className="room-num">Room {roman(ri + 1)}</span>
                <div className="room-fields">
                  <input
                    className="room-title"
                    value={room.title}
                    placeholder={ri === 0 ? 'How we met' : 'Name this chapter'}
                    aria-label="Chapter title"
                    onChange={(e) => patchRoom(room.id, { title: e.target.value })}
                  />
                  <input
                    className="room-subtitle"
                    value={room.subtitle}
                    placeholder="Years, e.g. 2019 – 2021"
                    aria-label="Chapter dates"
                    onChange={(e) => patchRoom(room.id, { subtitle: e.target.value })}
                  />
                </div>
                <ShapePicker value={room.shape ?? 'hall'} onChange={(shape) => patchRoom(room.id, { shape })} />
                <div className="moment-actions">
                  <button className="icon-btn" onClick={() => moveRoom(room.id, -1)} disabled={ri === 0} aria-label="Move room earlier">
                    ↑
                  </button>
                  <button className="icon-btn" onClick={() => moveRoom(room.id, 1)} disabled={isLast} aria-label="Move room later">
                    ↓
                  </button>
                  {museum.rooms.length > 1 && (
                    <button className="link-btn danger" onClick={() => removeRoom(room)}>
                      Remove room
                    </button>
                  )}
                </div>
              </header>

              <Dropzone
                busy={busy > 0 && addingTo === room.id}
                progress={addingTo === room.id ? progress : null}
                onFiles={(files) => addFiles(files, room.id)}
              />

              {inRoom.length > 0 && (
                <div className="moments-head">
                  <h3>
                    {inRoom.length} {inRoom.length === 1 ? 'moment' : 'moments'}
                  </h3>
                  <span className="muted">
                    {Math.min(shown, capacity)} of {capacity} wall spaces
                  </span>
                </div>
              )}
              {inRoom.length > shown && (
                <p className="note">
                  This room fits {capacity} moments. Move the last {inRoom.length - shown} into another room (or a new
                  one) to put them on display.
                </p>
              )}

              <ol className="moments">
                {inRoom.map((m, i) => (
                  <MomentCard
                    key={m.id}
                    moment={m}
                    index={i}
                    total={inRoom.length}
                    mediaUrl={urls[blobKey.media(m.id)]}
                    voiceUrl={urls[blobKey.voice(m.id)]}
                    place={placement.get(m.id) ?? null}
                    rooms={museum.rooms}
                    onRoom={(roomId) => setMomentRoom(m.id, roomId)}
                    onChange={(patch) => patchMoment(m.id, patch)}
                    onRemove={() => removeMoment(m)}
                    onMove={(dir) => moveMoment(m.id, dir)}
                    onVoice={(blob, name) => setVoice(m.id, blob, name)}
                    onRemoveVoice={() => removeVoice(m.id)}
                  />
                ))}
              </ol>
            </section>
          )
        })}
      </div>

      <button className="add-room" onClick={addRoom}>
        <span aria-hidden>＋</span> Add a chapter
        <span className="muted"> · a new room after “{museum.rooms[museum.rooms.length - 1]?.title || 'the last one'}”</span>
      </button>

      {museum.moments.length > 0 && (
        <>
          <div className="enter-bar">
            <span>
              <strong>{museum.names || 'Your museum'}</strong>
              <span className="muted">
                {' · '}
                {saving ? 'saving…' : repo.kind === 'cloud' ? 'saved to your account' : 'saved on this device'}
              </span>
            </span>
            <button className="btn btn-primary" onClick={enter} disabled={busy > 0}>
              Enter your museum →
            </button>
          </div>
          <button className="link-btn danger clear-all" onClick={clearAll}>
            {repo.kind === 'cloud' ? 'Remove all moments' : 'Remove everything from this device'}
          </button>
        </>
      )}
    </section>
  )
}

const SHAPE_OPTIONS: { value: RoomShape; label: string; hint: string; icon: ReactNode }[] = [
  {
    value: 'hall',
    label: 'Hall',
    hint: 'Big and bright, two centre walls · 18 spaces',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="5" y="2.5" width="14" height="19" rx="1" />
        <line x1="12" y1="7" x2="12" y2="10.5" />
        <line x1="12" y1="13.5" x2="12" y2="17" />
      </svg>
    ),
  },
  {
    value: 'rotunda',
    label: 'Skylight',
    hint: 'Round room lit from above: pictures hang on wires, petals fall · 12 spaces',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    value: 'corridor',
    label: 'Corridor',
    hint: 'Long, narrow and intimate · 15 spaces',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="9" y="1.5" width="6" height="21" rx="1" />
      </svg>
    ),
  },
]

/** Hall / Rotunda / Corridor segmented control. */
function ShapePicker({ value, onChange }: { value: RoomShape; onChange: (s: RoomShape) => void }) {
  return (
    <div className="shape-picker" role="radiogroup" aria-label="Room shape">
      {SHAPE_OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={`shape-option${value === o.value ? ' is-active' : ''}`}
          title={o.hint}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/** "5 November, 14:32" in the reader's own language and time zone. */
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

function AccountBar({ cloud }: { cloud: CloudInfo }) {
  const [copied, setCopied] = useState(false)
  const link = inviteLink(cloud.museum.inviteCode)
  const shared = cloud.museum.members >= 2

  const copy = async () => {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  // Phones: the share sheet (Telegram, WhatsApp, Messages…)
  const canShare = typeof navigator.share === 'function'
  const share = () =>
    navigator
      .share({ title: 'Our museum', text: 'Come build our museum with me ♥', url: link })
      .catch(() => {}) // closed the sheet

  return (
    <div className="account">
      <div className="account-who">
        <span className="muted">Signed in as</span> <strong>{cloud.email}</strong>
        <button className="link-btn" onClick={cloud.onSignOut}>
          Sign out
        </button>
      </div>
      {cloud.museum.visitCode && (
        <VisitShare link={visitLink(cloud.museum.visitCode)} visitors={cloud.museum.visitors} lastVisitAt={cloud.museum.lastVisitAt} />
      )}
      {cloud.museum.joinProblem && (
        <p className="error">Couldn’t join with that invite link: {cloud.museum.joinProblem}. You’re in your own museum for now.</p>
      )}
      {shared ? (
        <p className="account-invite">
          ♥ Shared with your partner. You both see and edit the same museum.
          {cloud.museum.partnerJoinedAt && (
            <span className="muted">
              {' '}
              {cloud.museum.role === 'partner' ? 'You joined' : 'They joined'} on {when(cloud.museum.partnerJoinedAt)}.
            </span>
          )}
        </p>
      ) : (
        <div className="account-invite">
          <span>Invite your partner to edit it with you (they sign in). Nobody has joined with this link yet:</span>
          <code className="invite-link">{link}</code>
          <button className="chip-btn" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          {canShare && (
            <button className="chip-btn" onClick={share}>
              Send…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** The no-sign-in link and its QR code: anyone who has it can walk through, nobody can change anything. */
function VisitShare({ link, visitors, lastVisitAt }: { link: string; visitors: number; lastVisitAt?: string }) {
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState<string | null>(null)

  const copy = async () => {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const canShare = typeof navigator.share === 'function'
  const share = () =>
    navigator.share({ title: 'Our museum', text: 'I made this for you ♥ Tap to walk through our museum', url: link }).catch(() => {})
  const toggleQr = async () => {
    if (qr) return setQr(null)
    const QRCode = await import('qrcode')
    setQr(await QRCode.toDataURL(link, { width: 640, margin: 2, color: { dark: '#1a1410', light: '#fdf8f0' } }))
  }

  return (
    <div className="account-visit">
      <p className="account-visit-head">
        <strong>Open it without signing in</strong>
        <span className="muted">Anyone with this link or QR code can walk through your museum. They can’t change anything.</span>
        <span className="muted">
          {visitors === 0
            ? 'Nobody has opened it yet.'
            : `Opened on ${visitors} ${visitors === 1 ? 'device' : 'devices'}${lastVisitAt ? `, last on ${when(lastVisitAt)}` : ''}.`}
        </span>
      </p>
      <div className="account-invite">
        <code className="invite-link">{link}</code>
        <button className="chip-btn" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        {canShare && (
          <button className="chip-btn" onClick={share}>
            Send…
          </button>
        )}
        <button className="chip-btn" onClick={toggleQr}>
          {qr ? 'Hide QR code' : 'QR code'}
        </button>
      </div>
      {qr && (
        <div className="visit-qr">
          <img src={qr} alt="QR code that opens the museum" />
          <a className="link-btn" href={qr} download="our-museum-qr.png">
            Save the QR code
          </a>
        </div>
      )}
    </div>
  )
}

function Dropzone({ busy, progress, onFiles }: { busy: boolean; progress: string | null; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    onFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <span className="dropzone-icon" aria-hidden>
        ＋
      </span>
      <strong>{busy ? 'Preparing your moments…' : 'Drop photos and videos here'}</strong>
      <span className="muted">
        {progress ?? 'or click to choose · JPEG, PNG, WebP, MP4 · large photos are compressed automatically'}
      </span>
    </div>
  )
}

function MomentCard({
  moment,
  index,
  total,
  mediaUrl,
  voiceUrl,
  place,
  rooms,
  onRoom,
  onChange,
  onRemove,
  onMove,
  onVoice,
  onRemoveVoice,
}: {
  moment: StoredMoment
  index: number
  total: number
  mediaUrl?: string
  voiceUrl?: string
  place: string | null
  rooms: StoredRoom[]
  onRoom: (roomId: string) => void
  onChange: (patch: Partial<StoredMoment>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  onVoice: (blob: Blob, name: string) => void
  onRemoveVoice: () => void
}) {
  return (
    <li className={`moment${place ? '' : ' moment--waiting'}`}>
      <div className="moment-media">
        {mediaUrl &&
          (moment.kind === 'photo' ? (
            <img src={mediaUrl} alt={moment.title || 'Photo'} />
          ) : (
            <video src={mediaUrl} muted playsInline preload="metadata" controls />
          ))}
        <span className="badge">{moment.kind === 'photo' ? 'Photo' : 'Film'}</span>
        {moment.bytes !== undefined && (
          <span className="size-note">
            {moment.originalBytes && moment.originalBytes > moment.bytes * 1.05
              ? `${formatBytes(moment.originalBytes)} → ${formatBytes(moment.bytes)}`
              : formatBytes(moment.bytes)}
          </span>
        )}
      </div>

      <div className="moment-fields">
        <div className="moment-row">
          <label className="field grow">
            <span>Title</span>
            <input value={moment.title} placeholder="Name this moment" onChange={(e) => onChange({ title: e.target.value })} />
          </label>
          <label className="field date">
            <span>Date</span>
            <input value={moment.date} placeholder="When was it?" onChange={(e) => onChange({ date: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>Caption</span>
          <textarea
            rows={2}
            value={moment.caption}
            placeholder="What do you remember about it?"
            onChange={(e) => onChange({ caption: e.target.value })}
          />
        </label>

        {moment.kind === 'photo' && (
          <div className="voice">
            {moment.voice && voiceUrl ? (
              <>
                <PlayChip src={voiceUrl} />
                <span className="track-name">♪ {moment.voice.name}</span>
                <button className="link-btn" onClick={onRemoveVoice}>
                  Remove
                </button>
              </>
            ) : (
              <>
                <span className="muted">Voice note</span>
                <Recorder onDone={(blob) => onVoice(blob, 'Recorded voice note')} />
                <FileButton accept="audio/*" className="chip-btn" onFile={(f) => onVoice(f, f.name)}>
                  Upload
                </FileButton>
              </>
            )}
          </div>
        )}

        <div className="moment-foot">
          <span className={`place${place ? '' : ' place--waiting'}`}>{place ?? 'Not on display — room is full'}</span>
          {rooms.length > 1 && (
            <select
              className="room-select"
              value={moment.roomId}
              aria-label="Room"
              onChange={(e) => onRoom(e.target.value)}
            >
              {rooms.map((r, i) => (
                <option key={r.id} value={r.id}>
                  Room {roman(i + 1)}
                  {r.title ? ` · ${r.title}` : ''}
                </option>
              ))}
            </select>
          )}
          <div className="moment-actions">
            <button className="icon-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move earlier">
              ↑
            </button>
            <button className="icon-btn" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move later">
              ↓
            </button>
            <button className="link-btn danger" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

function Recorder({ onDone }: { onDone: (blob: Blob) => void }) {
  const [seconds, setSeconds] = useState<number | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)

  useEffect(() => () => recorder.current?.stop(), [])

  useEffect(() => {
    if (seconds === null) return
    if (seconds >= MAX_RECORDING_SECONDS) {
      recorder.current?.stop()
      return
    }
    const t = setTimeout(() => setSeconds((s) => (s === null ? s : s + 1)), 1000)
    return () => clearTimeout(t)
  }, [seconds])

  const start = async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      alert('Microphone access was blocked. Allow it in the address bar to record a voice note.')
      return
    }
    const mr = new MediaRecorder(stream)
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => chunks.push(e.data)
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      recorder.current = null
      setSeconds(null)
      if (chunks.length) onDone(new Blob(chunks, { type: mr.mimeType }))
    }
    mr.start()
    recorder.current = mr
    setSeconds(0)
  }

  if (seconds !== null) {
    return (
      <button className="chip-btn recording" onClick={() => recorder.current?.stop()}>
        ■ Stop · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </button>
    )
  }
  return (
    <button className="chip-btn" onClick={start}>
      ● Record
    </button>
  )
}

function PlayChip({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  return (
    <>
      <audio ref={audio} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <button
        className="icon-btn"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
      >
        {playing ? '❚❚' : '▶'}
      </button>
    </>
  )
}

function FileButton({
  accept,
  onFile,
  className,
  children,
}: {
  accept: string
  onFile: (f: File) => void
  className: string
  children: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <button className={className} onClick={() => input.current?.click()}>
        {children}
      </button>
    </>
  )
}
