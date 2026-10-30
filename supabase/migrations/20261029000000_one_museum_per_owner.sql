-- Each account owns at most one museum (a partner joins the owner's museum
-- instead). Guards against two first sign-ins racing to create one each.
create unique index museums_one_per_owner on public.museums (owner_id);
