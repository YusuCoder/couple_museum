-- Rooms come in shapes: the big hall, a domed rotunda, a long corridor.
-- Apply after 20261025000000_museum_rooms.sql.

alter table public.museum_rooms
  add column shape text not null default 'hall'
  check (shape in ('hall', 'rotunda', 'corridor'));
