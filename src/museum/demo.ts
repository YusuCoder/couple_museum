import type { StoredMoment, StoredMuseum } from '../content/db'
import { layoutBuilding } from '../content/layout'
import type { RoomContent } from './exhibits'
import type { RoomShape } from './floorplan'

type DemoMoment = Omit<StoredMoment, 'roomId'> & { hue?: [string, string]; file?: string; voiceFile?: string }

/** The sample museum shown at /museum?demo or before a couple adds anything: three chapters. */
const CHAPTERS: { id: string; shape: RoomShape; title: string; subtitle: string; moments: DemoMoment[] }[] = [
  {
    id: 'met',
    shape: 'hall',
    title: 'How we met',
    subtitle: 'Chapter I · 2021',
    moments: [
      { id: 'met', kind: 'photo', title: 'The day we met', date: 'March 14, 2021', caption: 'A rainy afternoon, one umbrella, two strangers.', aspect: 4 / 3, voice: { name: 'met' }, voiceFile: '/media/met.m4a', hue: ['#f6a57a', '#6b3fa0'] },
      { id: 'coffee', kind: 'photo', title: 'First coffee', date: 'March 20, 2021', caption: 'You ordered for me. You were right.', aspect: 3 / 4, hue: ['#d9b48f', '#3d2b1f'] },
      { id: 'park', kind: 'photo', title: 'Picnic in the park', date: 'May 2, 2021', caption: 'We forgot the forks. Nobody cared.', aspect: 3 / 2, hue: ['#bbf7d0', '#166534'] },
      { id: 'trip', kind: 'photo', title: 'Our first trip', date: 'August 2, 2021', caption: 'Samarkand at sunset. We got lost twice.', aspect: 3 / 2, hue: ['#ffcf70', '#c2410c'] },
      { id: 'concert', kind: 'photo', title: 'Concert night', date: 'October 16, 2021', caption: 'Front row, no voice left.', aspect: 4 / 5, hue: ['#c4b5fd', '#312e81'] },
      { id: 'rain', kind: 'photo', title: 'Rainy Sunday', date: 'November 7, 2021', caption: 'Tea, blankets and a very long film.', aspect: 3 / 2, hue: ['#cbd5e1', '#475569'] },
      { id: 'snow', kind: 'photo', title: 'First snow', date: 'December 11, 2021', caption: 'Snowball fight. You lost.', aspect: 4 / 5, hue: ['#e0f2fe', '#1e3a8a'] },
    ],
  },
  {
    id: 'wedding',
    shape: 'rotunda',
    title: 'Our wedding',
    subtitle: 'Chapter II · 2022 – 2024',
    moments: [
      { id: 'proposal', kind: 'photo', title: 'She said yes', date: 'June 5, 2022', caption: 'Hands shaking, heart louder than the waves.', aspect: 4 / 3, voice: { name: 'proposal' }, voiceFile: '/media/proposal.m4a', hue: ['#fbcfe8', '#9d174d'] },
      { id: 'cat', kind: 'photo', title: 'Mosh joins the family', date: 'August 20, 2022', caption: 'Small, loud, ours.', aspect: 4 / 5, hue: ['#fed7aa', '#9a3412'] },
      { id: 'home', kind: 'photo', title: 'Our first home', date: 'October 1, 2022', caption: 'Empty rooms, full hearts.', aspect: 3 / 4, hue: ['#d1fae5', '#065f46'] },
      { id: 'first-dance', kind: 'video', title: 'Our first dance', date: 'September 9, 2024', caption: 'Everyone was watching. I only saw you.', aspect: 16 / 9, file: '/media/first-dance.mp4' },
      { id: 'mountains', kind: 'photo', title: 'Above the clouds', date: 'April 22, 2023', caption: 'Chimgan, 6 a.m., worth every step.', aspect: 3 / 2, hue: ['#e2e8f0', '#334155'] },
      { id: 'wedding', kind: 'photo', title: 'Forever starts here', date: 'September 9, 2024', caption: 'The best day. The first of many.', aspect: 3 / 2, hue: ['#fff7ed', '#b45309'] },
    ],
  },
  {
    id: 'after',
    shape: 'corridor',
    title: 'Our first year',
    subtitle: 'Chapter III · 2024 – 2025',
    moments: [
      { id: 'anniversary', kind: 'video', title: 'Happy anniversary', date: 'September 9, 2025', caption: 'A message for the first of many.', aspect: 16 / 9, file: '/media/wedding-film.mp4' },
      { id: 'road', kind: 'photo', title: 'Road trip to Bukhara', date: 'May 9, 2023', caption: 'Eleven hours, one playlist, zero regrets.', aspect: 3 / 2, hue: ['#fde68a', '#a16207'] },
      { id: 'sea', kind: 'photo', title: 'By the sea', date: 'July 18, 2025', caption: 'Salt, sun and nowhere to be.', aspect: 3 / 2, hue: ['#a5f3fc', '#0e7490'] },
      { id: 'new-year', kind: 'photo', title: 'New Year’s Eve', date: 'December 31, 2024', caption: 'Fireworks over the city, your hand in mine.', aspect: 4 / 3, hue: ['#fbcfe8', '#1e1b4b'] },
      { id: 'kitchen', kind: 'photo', title: 'Dancing in the kitchen', date: 'February 14, 2025', caption: 'No music needed.', aspect: 4 / 5, hue: ['#fde68a', '#7c2d12'] },
      { id: 'forever', kind: 'photo', title: 'Here’s to forever', date: 'September 9, 2025', caption: 'One year down. All of them to go.', aspect: 3 / 2, hue: ['#fecdd3', '#881337'] },
    ],
  },
]

const all = CHAPTERS.flatMap((c) => c.moments)
const hues = new Map(all.map((m) => [m.id, m.hue]))

const museum: StoredMuseum = {
  names: 'Aziz & Malika',
  since: '2021',
  rooms: CHAPTERS.map(({ id, shape, title, subtitle }) => ({ id, shape, title, subtitle })),
  moments: CHAPTERS.flatMap((c) => c.moments.map((m) => ({ ...m, roomId: c.id }))),
}

export const DEMO_ROOMS: RoomContent[] = layoutBuilding(museum, {
  media: new Map(all.map((m) => [m.id, m.file ?? `placeholder:${m.id}`])),
  voice: new Map(all.filter((m) => m.voiceFile).map((m) => [m.id, m.voiceFile!])),
}).map((room) => ({
  ...room,
  // Demo photos have no files: drop the stand-in URL so Frame paints a placeholder
  exhibits: room.exhibits.map((e) => ({ ...e, src: undefined, hue: hues.get(e.id) })),
}))
