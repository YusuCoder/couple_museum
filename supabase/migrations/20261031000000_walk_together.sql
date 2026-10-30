-- Walking together: each visitor's figure is sent over the private Realtime
-- channel `museum:<museum id>`. Only that museum's members (owner, partner,
-- and guests from the visit link) may listen or send on it.

create function public.can_use_museum_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if topic is null or topic not like 'museum:%' then
    return false;
  end if;
  return public.is_museum_member(substr(topic, 8)::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

create policy "museum members listen" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and public.can_use_museum_topic((select realtime.topic())));

create policy "museum members send" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and public.can_use_museum_topic((select realtime.topic())));
