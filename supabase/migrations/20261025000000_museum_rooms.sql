-- Rooms (chapters) of a museum building: "How we met", "Our wedding", ...
-- Each moment hangs in one room. Apply after 20261024000000_museum_core.sql.

create table public.museum_rooms (
  id uuid primary key,
  museum_id uuid not null references public.museums (id) on delete cascade,
  position integer not null,
  title text not null default '',
  subtitle text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index museum_rooms_museum_position_idx on public.museum_rooms (museum_id, position);

create trigger museum_rooms_touch before update on public.museum_rooms
  for each row execute function public.touch_updated_at();

-- Moments without a room (from before rooms existed) are shown in the first room by the app
alter table public.moments
  add column room_id uuid references public.museum_rooms (id) on delete set null;

create index moments_room_idx on public.moments (room_id);

alter table public.museum_rooms enable row level security;

create policy "members read rooms" on public.museum_rooms
  for select to authenticated
  using (public.is_museum_member(museum_id));

create policy "members add rooms" on public.museum_rooms
  for insert to authenticated
  with check (public.is_museum_member(museum_id));

create policy "members edit rooms" on public.museum_rooms
  for update to authenticated
  using (public.is_museum_member(museum_id))
  with check (public.is_museum_member(museum_id));

create policy "members remove rooms" on public.museum_rooms
  for delete to authenticated
  using (public.is_museum_member(museum_id));
