# Couple Museum — MVP Plan

A browser-based 3D museum where a couple walks together through rooms of their
shared story: photos, videos, voice notes, captions.

**Stack:** Vite + React + TypeScript · Three.js via React Three Fiber · drei ·
@react-three/rapier (collisions) · @react-three/postprocessing · Supabase
(auth, storage, realtime) · Blender for final room models (baked lighting).

**Realism principles** (apply at every step):
- Light the art, not the room: warm spotlight per frame, dim surroundings.
- Physical frames: depth, passe-partout, glass, brass plaque.
- Slightly reflective floor, image-based reflections, subtle AO/bloom/vignette.
- Human-scale camera: 1.65 m eye height, eased walking, gentle head-bob.
- Sound matters as much as visuals (footsteps, room reverb, ambience).
- Keep 60 fps: few draw calls, compressed textures, lazy-load photos.

---

## Step 1 — Walkable gallery room (procedural) ✅
- One long gallery hall built in code (walls, floor, ceiling, light strips,
  baseboards, a bench).
- First-person controls: click to enter (pointer lock), WASD + mouse, Shift to
  walk faster; capsule collider so you can't walk through walls or the bench.
- Exhibit component: frame + mat + photo + glass + brass plaque + spotlight.
- Exhibits driven by a data list (title, date, caption, image URL); generated
  placeholder art until real photos exist.
- Post-processing: ambient occlusion, bloom, vignette, ACES tone mapping.

**Done when:** you can walk the hall at 60 fps on a laptop and it reads as a
real gallery.

## Step 2 — Interaction with exhibits ✅
- Look at an exhibit → highlight + "E / click to view".
- View mode: camera glides to frame the photo; show full caption; Esc returns.
- Video exhibits (`VideoTexture` on a wall screen) and voice-note exhibits
  (positional audio that starts when you approach).
- Footsteps + room reverb + optional background music.
- Built: look-at focus + prompt, E/click to view, ←/→ browse in story order,
  E/click to return, Esc pauses; synthesized footsteps, room tone, reverb,
  generative ambient music (M toggles, ducks under voice notes/films). Demo
  media in `public/media/` was generated with macOS `say` + ffmpeg.

## Step 3 — Content from the couple ✅ local-first (Supabase still to do)
- Auth (magic link / Telegram), a `museums` row per couple, invite partner by link.
- Simple 2D editor: upload photos/videos/voice notes to Storage, write
  title/date/caption, order them, pick a room ("chapter").
- Museum loads exhibits from DB; image resizing + KTX2/WebP for performance;
  photos lazy-load by room.
- Auto-layout: exhibits flow along walls by order and aspect ratio.
- Built (local-first): landing page at `/` with builder — names/year, photos
  and films (drag-drop, photos downscaled to 2400px JPEG), titles/dates/
  captions, reorder, voice notes (upload or record), soundtrack upload. Saved
  in IndexedDB (`src/content/db.ts`); museum at `/museum` (`?demo` for demo).
  Still to do: Supabase auth + storage so the partner can open the same museum.

## Step 3b — Visitor character ✅
- Third-person by default (V toggles first person): over-the-shoulder camera
  that pulls in at walls, Mixamo-rigged character with idle/walk/run blended by
  speed, clip speed matched to ground speed, turns toward movement, blob shadow.
- `public/models/him.glb`: a MetaPerson (selfie) avatar animated in Mixamo,
  converted FBX → GLB (three.js FBXLoader + GLTFExporter, then gltf-transform:
  WebP textures, meshopt, resampled clips; 190 MB of FBX → 2.9 MB). Clips:
  Idle, Walk, Run, SitDown, Sitting, StandUp, PickUp, Kiss, DanceTut,
  BboyToIdle, HeadspinStart, HeadspinEnd. Face shapes kept: blink, smile,
  brow, pucker (he blinks and smiles faintly).
- Benches (`src/museum/Seats.tsx`): E at a bench sits down on the side you
  stand on, facing away from it; the camera turns to the view and drops to
  seated height. E / Space / a walking key stands up. Every bench works;
  halls also get one facing the title-wall film. Films keep playing
  within 9 m.
- Romantic hush (Skylight room): standing in the circle of light slowly dims
  the building to a warm glow (~4.5 s; back up in 2.5 s) and a soft spotlight
  falls through the skylight on the couple. Only light intensities/colours
  change; the spotlight is always mounted at 0 (adding lights recompiles
  every material). See `romance` in `src/museum/Skylight.tsx`.
- Her (`public/models/her.glb`, 3.0 MB): MetaPerson + her own Mixamo Idle,
  Dwarf Walk, Running, Sitting; his SitDown/StandUp/PickUp/Kiss borrowed
  (same skeleton; hips travel scaled ×1.05). Outfit simplified 54k → 22k tris.
- Companion (`src/museum/Partner.tsx`) until online visits exist: walks at his
  side (or behind him through doorways), catches up if lost, sits beside him
  on benches, and in the Skylight circle steps in for the embrace — his left
  arm round her waist, her right hand on his shoulder, posed with two-bone IK
  on top of the idle clips (`src/museum/embrace.ts`).
- One `Avatar` (Character.tsx) drives both bodies (`body.ts`). Bench clips
  are rebased so the figure never jumps and every change cross-fades.
- People are on their own layer (1), kept out of the floor reflection —
  that alone took the frame rate from ~63 to ~70 fps with both of them.

## Step 3c — Bigger hall with centre walls ✅
- Hall 14 × 34 × 5.5 m, two skylight strips, two free-standing centre walls
  (deep green) with a large piece on each face, five benches.
- Layout fills centre faces first, then side walls (12 spots), keeps story
  order along the walk; a second film is moved onto the nearest centre wall.
  Capacity: 16 + finale + entrance film. Walls block the look-at ray.

## Step 4 — Walk together (realtime)
- Supabase Realtime channel per museum: broadcast position/rotation ~10–15 Hz,
  interpolate on the other side.
- Partner avatar (stylized glowing silhouette + name), presence ("Aziza is in
  'First trip'").
- Shared moments: reactions/notes left at exhibits, "hold hands" follow mode,
  optional voice chat (WebRTC) later.

## Step 5 — Multiple rooms & chapters ✅ (pulled forward)
- Hall → chapter rooms connected by doorways ("How we met", "First trip",
  "Wedding", …), each with its own lighting mood and wall color.
- Final room: mosaic wall of all photos / "future" room with empty frames.
- Room loading per chapter (unload far rooms).
- Built: visitors start on a plaza outside a modern concrete front (brass
  lettering, glass entrance bay, canopy, reflecting pools) and open the
  dark-green double doors with E. Rooms follow in a
  row joined by doorways with a "Next · Chapter II" sign; each room has its
  chapter title wall; the last room keeps the finale. Only the current room
  and its neighbours are mounted; one reflective floor for the whole building.
  Builder: chapters with title + years, per-room drop zones, move moments
  between rooms. Supabase: `20261025000000_museum_rooms.sql` (not applied).
- Room shapes: hall (bright, centre walls), rotunda (round, green curved
  wall, dome + oculus, centre title wall), corridor (narrow, dark, low
  ceiling). Chosen per chapter in the builder; rooms of any shape chain via
  their own near/far doorway walls (`buildingPlan` in floorplan.ts).
  Supabase: `20261025120000_room_shapes.sql` (not applied).
- Rotunda became the "Skylight" room (Skylight.tsx): warm-white round room,
  wide oculus with a soft light beam, title on the floor in the light, big
  piece hanging in the beam, pictures on brass wires in a ring, falling petals.
  (A night-sky "Starlight" version was tried and dropped: too much.)
- All rooms are built at startup and only shown when near; a warm-up pass
  precompiles shaders/uploads textures (mounting rooms mid-walk froze ~0.3 s).
- Doors between rooms (Doors.tsx): ivory lacquer double doors with brass
  pulls; E/click to open (swing away from the visitor, soft sound), close by
  themselves 9 m away. Block walking and the look-at ray while closed.

## Step 6 — Production realism (Blender)
- Model rooms in Blender, bake GI + AO into lightmaps, export compressed `.glb`
  (Draco/Meshopt, KTX2 textures); keep frames dynamic in code.
- PBR materials (Poly Haven / ambientCG): polished concrete or oak floor,
  plaster walls.
- Quality presets (low/medium/high) and auto-detect.

## Step 7 — Mobile & polish
- ✅ Phones (portrait): `touch.ts` detects touch screens (`?touch` forces it). Thumb stick (push fully to run), drag anywhere to look, tap the scene or the prompt card to view / open / sit, Stand up card, top buttons for view / music / pause. Portrait widens the field of view (up to 84°) and puts the third-person camera over his left shoulder so she stays in frame. Phones start on low quality with a 512 px floor reflection.
- Tap-to-walk to an exhibit.
- Loading screen with progress, intro fly-through, share link / OG image.
- Accessibility: 2D "timeline" fallback view of the same story.

---

## Later ideas
- Gaussian-splat scanned spaces for photoreal rooms.
- AI-written exhibit captions from photo + date.
- Anniversary mode: new room unlocks each year.
- Guest mode: friends visit and leave notes in the guestbook.
