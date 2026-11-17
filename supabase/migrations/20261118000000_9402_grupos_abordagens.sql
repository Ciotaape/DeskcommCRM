-- manifest: **Aba Grupos › Abordagem: registro de quem já foi chamado no privado.**
-- Uma linha por telefone abordado (a chave de telefone do painel), para a lista
-- de "quem ainda não comprou" não oferecer de novo quem já recebeu a abordagem.
create table if not exists public.grupos_abordagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  telefone_chave text not null,
  contact_id uuid,
  conversation_id uuid,
  template_id uuid,
  abordado_por uuid not null,
  abordado_em timestamptz not null default now(),
  unique (organization_id, telefone_chave)
);
alter table public.grupos_abordagens enable row level security;
drop policy if exists tenant_isolation_grupos_abordagens_select on public.grupos_abordagens;
create policy tenant_isolation_grupos_abordagens_select on public.grupos_abordagens
  for select to authenticated using (organization_id in (select public.fn_user_org_ids()));
revoke insert, update, delete, truncate on public.grupos_abordagens from anon, authenticated;
