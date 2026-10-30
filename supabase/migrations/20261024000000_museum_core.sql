-- Couple Museum: one museum per couple, shared by its owner and one partner.
-- Media lives in the private `museum-media` bucket under `<museum_id>/...`.

create table public.museums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  names text not null default '',
  since text not null default '',
  music_path text,
  music_name text,
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.museum_members (
  museum_id uuid not null references public.museums (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'partner')),
  joined_at timestamptz not null default now(),
  primary key (museum_id, user_id)
);

create index museum_members_user_idx on public.museum_members (user_id);

create table public.moments (
  id uuid primary key,
  museum_id uuid not null references public.museums (id) on delete cascade,
  position integer not null,
  kind text not null check (kind in ('photo', 'video')),
  title text not null default '',
  date text not null default '',
  caption text not null default '',
  aspect double precision not null check (aspect > 0),
  media_path text not null,
  voice_path text,
  voice_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index moments_museum_position_idx on public.moments (museum_id, position);

-- ---------------------------------------------------------------- helpers

create function public.is_museum_member(m uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.museum_members
    where museum_id = m and user_id = (select auth.uid())
  );
$$;

-- Storage object names look like '<museum_id>/<file>'; anything else is denied.
create function public.can_access_museum_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.is_museum_member(split_part(object_name, '/', 1)::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger museums_touch before update on public.museums
  for each row execute function public.touch_updated_at();
create trigger moments_touch before update on public.moments
  for each row execute function public.touch_updated_at();

-- The creator of a museum becomes its owner member automatically.
create function public.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.museum_members (museum_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger museums_add_owner after insert on public.museums
  for each row execute function public.add_owner_membership();

-- Partner joins with the invite code from the owner's link. Two people per museum.
create function public.join_museum(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  mid uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select id into mid from public.museums where invite_code = code;
  if mid is null then
    raise exception 'This invite link is not valid';
  end if;

  if exists (select 1 from public.museum_members where museum_id = mid and user_id = auth.uid()) then
    return mid;
  end if;

  if (select count(*) from public.museum_members where museum_id = mid) >= 2 then
    raise exception 'This museum already has two members';
  end if;

  insert into public.museum_members (museum_id, user_id, role) values (mid, auth.uid(), 'partner');
  return mid;
end;
$$;

revoke execute on function public.join_museum(text) from public, anon;
grant execute on function public.join_museum(text) to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.museums enable row level security;
alter table public.museum_members enable row level security;
alter table public.moments enable row level security;

create policy "members read their museum" on public.museums
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_museum_member(id));

create policy "users create their own museum" on public.museums
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "members edit their museum" on public.museums
  for update to authenticated
  using (public.is_museum_member(id))
  with check (public.is_museum_member(id));

create policy "owner deletes museum" on public.museums
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "members see each other" on public.museum_members
  for select to authenticated
  using (public.is_museum_member(museum_id));

create policy "members read moments" on public.moments
  for select to authenticated
  using (public.is_museum_member(museum_id));

create policy "members add moments" on public.moments
  for insert to authenticated
  with check (public.is_museum_member(museum_id));

create policy "members edit moments" on public.moments
  for update to authenticated
  using (public.is_museum_member(museum_id))
  with check (public.is_museum_member(museum_id));

create policy "members remove moments" on public.moments
  for delete to authenticated
  using (public.is_museum_member(museum_id));

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('museum-media', 'museum-media', false)
on conflict (id) do nothing;

create policy "museum members read media" on storage.objects
  for select to authenticated
  using (bucket_id = 'museum-media' and public.can_access_museum_object(name));

create policy "museum members upload media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'museum-media' and public.can_access_museum_object(name));

create policy "museum members replace media" on storage.objects
  for update to authenticated
  using (bucket_id = 'museum-media' and public.can_access_museum_object(name))
  with check (bucket_id = 'museum-media' and public.can_access_museum_object(name));

create policy "museum members delete media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'museum-media' and public.can_access_museum_object(name));
