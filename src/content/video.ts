import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeVideo,
} from 'mediabunny'

/**
 * Video compression, in the browser (WebCodecs — hardware encoders, no
 * server). A film plays on a screen in a museum wall, so 720p is plenty; the
 * bitrate is chosen so the file fits the storage upload limit (50 MB on
 * Supabase's free plan) with room to spare.
 */
const MAX_SIDE = 1280
const TARGET_BYTES = 45 * 1024 * 1024
/** Below this a video is left as it is (already small enough to load quickly). */
export const COMPRESS_OVER_BYTES = 20 * 1024 * 1024
const MAX_BITRATE = 3_000_000
const MIN_BITRATE = 400_000
/** Room left for the sound track (bits per second). */
const AUDIO_ALLOWANCE = 192_000

/** Re-encode to H.264 MP4 at ≤ 720p. Returns the original when it is small already or the browser can't encode. */
export async function prepareVideo(blob: Blob, onProgress?: (fraction: number) => void): Promise<Blob> {
  if (blob.size <= COMPRESS_OVER_BYTES) return blob
  if (typeof VideoEncoder === 'undefined' || !(await canEncodeVideo('avc'))) {
    throw new Error('This browser can’t compress videos. Try Chrome, or upload a shorter video.')
  }

  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error('That file has no video in it.')
  const duration = await input.computeDuration()
  const w = track.displayWidth
  const h = track.displayHeight
  const bitrate = Math.round(
    Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, (TARGET_BYTES * 8) / Math.max(duration, 1) - AUDIO_ALLOWANCE)),
  )

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const conversion = await Conversion.init({
    input,
    output,
    video: {
      // Scale the long side down to 1280 px, never up
      ...(w >= h ? { width: Math.min(MAX_SIDE, w) } : { height: Math.min(MAX_SIDE, h) }),
      codec: 'avc',
      bitrate,
    },
    // Phone videos already carry AAC sound: copied as it is (other codecs are re-encoded to fit MP4)
    audio: {},
  })
  const lostSound = conversion.discardedTracks.some((t) => t.track.type === 'audio')
  if (!conversion.isValid || lostSound) {
    const why = conversion.discardedTracks.map((t) => t.reason).join(', ')
    throw new Error(`Couldn't compress this video (${why || 'unsupported format'}).`)
  }
  conversion.onProgress = (p) => onProgress?.(p)
  await conversion.execute()

  const buffer = output.target.buffer
  if (!buffer) throw new Error("Couldn't compress this video.")
  return new Blob([buffer], { type: 'video/mp4' })
}
