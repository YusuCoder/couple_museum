-- Visit links: open the museum from a link or QR code without an account.
-- The visitor's browser signs in anonymously and becomes a read-only 'guest'
-- member. Only the owner and partner can change anything; guests don't count
-- towards the two-person limit.
-- Needs "Allow anonymous sign-ins" switched on (Authentication → Sign In / Providers).

alter table public.museums
  add column visit_code text not null unique default replace(gen_random_uuid()::text, '-', '');

alter table public.museum_members drop constraint museum_members_role_check;
alter table public.museum_members
  add constraint museum_members_role_check check (role in ('owner', 'partner', 'guest'));

-- ---------------------------------------------------------------- helpers

create function public.is_museum_editor(m uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.museum_members
    where museum_id = m and user_id = (select auth.uid()) and role in ('owner', 'partner')
  );
$$;

create function public.can_edit_museum_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.is_museum_editor(split_part(object_name, '/', 1)::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

create function public.is_anonymous_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
$$;

-- Partner invite: counts only the couple; an anonymous visitor can't take the partner place;
-- a guest who joins with the invite becomes the partner.
create or replace function public.join_museum(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  mid uuid;
  current_role_name text;
begin
  if auth.uid() is null or public.is_anonymous_user() then
    raise exception 'Sign in first';
  end if;

  select id into mid from public.museums where invite_code = code;
  if mid is null then
    raise exception 'This invite link is not valid';
  end if;

  select role into current_role_name from public.museum_members where museum_id = mid and user_id = auth.uid();
  if current_role_name in ('owner', 'partner') then
    return mid;
  end if;

  if (select count(*) from public.museum_members where museum_id = mid and role in ('owner', 'partner')) >= 2 then
    raise exception 'This museum already has two members';
  end if;

  insert into public.museum_members (museum_id, user_id, role) values (mid, auth.uid(), 'partner')
  on conflict (museum_id, user_id) do update set role = 'partner', joined_at = now();
  return mid;
end;
$$;

-- Visit link: anyone signed in (including anonymously) may look round, nothing more.
create function public.visit_museum(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  mid uuid;
begin
  if auth.uid() is null then
    raise exception 'Open the link again';
  end if;

  select id into mid from public.museums where visit_code = code;
  if mid is null then
    raise exception 'This museum link is not valid';
  end if;

  insert into public.museum_members (museum_id, user_id, role) values (mid, auth.uid(), 'guest')
  on conflict (museum_id, user_id) do update set joined_at = now();
  return mid;
end;
$$;

revoke execute on function public.visit_museum(text) from public, anon;
grant execute on function public.visit_museum(text) to authenticated;

-- ---------------------------------------------------------------- write policies: couple only

drop policy "users create their own museum" on public.museums;
create policy "users create their own museum" on public.museums
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and not public.is_anonymous_user());

drop policy "members edit their museum" on public.museums;
create policy "members edit their museum" on public.museums
  for update to authenticated
  using (public.is_museum_editor(id))
  with check (public.is_museum_editor(id));

drop policy "members add moments" on public.moments;
create policy "members add moments" on public.moments
  for insert to authenticated
  with check (public.is_museum_editor(museum_id));

drop policy "members edit moments" on public.moments;
create policy "members edit moments" on public.moments
  for update to authenticated
  using (public.is_museum_editor(museum_id))
  with check (public.is_museum_editor(museum_id));

drop policy "members remove moments" on public.moments;
create policy "members remove moments" on public.moments
  for delete to authenticated
  using (public.is_museum_editor(museum_id));

drop policy "members add rooms" on public.museum_rooms;
create policy "members add rooms" on public.museum_rooms
  for insert to authenticated
  with check (public.is_museum_editor(museum_id));

drop policy "members edit rooms" on public.museum_rooms;
create policy "members edit rooms" on public.museum_rooms
  for update to authenticated
  using (public.is_museum_editor(museum_id))
  with check (public.is_museum_editor(museum_id));

drop policy "members remove rooms" on public.museum_rooms;
create policy "members remove rooms" on public.museum_rooms
  for delete to authenticated
  using (public.is_museum_editor(museum_id));

drop policy "museum members upload media" on storage.objects;
create policy "museum members upload media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'museum-media' and public.can_edit_museum_object(name));

drop policy "museum members replace media" on storage.objects;
create policy "museum members replace media" on storage.objects
  for update to authenticated
  using (bucket_id = 'museum-media' and public.can_edit_museum_object(name))
  with check (bucket_id = 'museum-media' and public.can_edit_museum_object(name));

drop policy "museum members delete media" on storage.objects;
create policy "museum members delete media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'museum-media' and public.can_edit_museum_object(name));
