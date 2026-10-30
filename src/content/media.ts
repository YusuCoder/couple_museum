/**
 * Photo compression. Phone and camera originals are often 10–50 MB; in the
 * museum a photo is at most ~2.5 m wide on a wall, so 2560 px on the long side
 * stays sharp even when viewed up close. We aim for under ~900 KB per photo.
 */
const MAX_PHOTO_SIDE = 2560
const MIN_PHOTO_SIDE = 1600
const TARGET_BYTES = 900 * 1024
const QUALITIES = [0.86, 0.8, 0.74, 0.68, 0.62]

export interface PreparedPhoto {
  blob: Blob
  aspect: number
  originalBytes: number
}

/** Pixel size as displayed (EXIF rotation applied), read from the header without decoding all pixels. */
function naturalSize(file: File) {
  return new Promise<{ w: number; h: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode'))
    }
    img.src = url
  })
}

/** Decode straight to the size we need — a 50 MB original never sits in memory at full resolution. */
async function decode(file: File, maxSide: number) {
  const { w, h } = await naturalSize(file)
  const scale = Math.min(1, maxSide / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))
  const at = (rw: number, rh: number) =>
    createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' })

  const bitmap = await at(tw, th)
  // Some browsers resize before applying EXIF rotation, which squashes rotated
  // phone photos — detect the flipped aspect and decode again with swapped sizes
  if (tw !== th && Math.sign(bitmap.width - bitmap.height) !== Math.sign(tw - th)) {
    bitmap.close()
    const swapped = await at(th, tw)
    return swapped
  }
  return bitmap
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Browsers that can't encode WebP silently return PNG — detect once. */
let webpSupported: Promise<boolean> | null = null
function canEncodeWebp() {
  webpSupported ??= (async () => {
    const c = document.createElement('canvas')
    c.width = c.height = 2
    const b = await encode(c, 'image/webp', 0.8)
    return b?.type === 'image/webp'
  })()
  return webpSupported
}

/** Resize + re-encode so the museum stays fast and storage stays small. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const type = (await canEncodeWebp()) ? 'image/webp' : 'image/jpeg'

  let best: Blob | null = null
  let aspect = 1
  for (let side = MAX_PHOTO_SIDE; side >= MIN_PHOTO_SIDE; side = Math.round(side * 0.8)) {
    let bitmap: ImageBitmap
    try {
      bitmap = await decode(file, side)
    } catch {
      throw new Error(
        /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type)
          ? `“${file.name}” is a HEIC photo, which this browser can't open. Export it as JPEG (or open this page in Safari).`
          : `“${file.name}” couldn't be opened. The file may be damaged or in a format this browser can't read.`,
      )
    }
    aspect = bitmap.width / bitmap.height
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    // Step quality down until it fits; only then give up resolution
    for (const q of QUALITIES) {
      const blob = await encode(canvas, type, q)
      if (!blob) continue
      if (!best || blob.size < best.size) best = blob
      if (blob.size <= TARGET_BYTES) return { blob, aspect, originalBytes: file.size }
    }
    canvas.width = canvas.height = 0 // free the pixels before the next attempt
  }
  if (!best) throw new Error(`Could not compress “${file.name}”.`)
  return { blob: best, aspect, originalBytes: file.size }
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function videoAspect(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9)
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This video format is not supported by your browser. Try MP4 (H.264).'))
    }
    v.src = url
  })
}

/** "IMG_2041_beach-day.jpg" → "Beach day" */
export function titleFromFilename(name: string) {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/^(img|vid|dsc|pxl|mvimg)[_-]?\d*[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\d{6,}\b/g, '')
    .trim()
  return base ? base[0].toUpperCase() + base.slice(1) : ''
}
