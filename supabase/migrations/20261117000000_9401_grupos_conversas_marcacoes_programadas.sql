-- manifest: **Aba Grupos: etiqueta de cliente por participante, marcação manual e mensagens programadas nos grupos.**
--
-- 1. `vendas_externas.renovacao` — a venda veio de renovação de assinatura.
-- 2. `grupos_painel_marcacoes` — a situação de um telefone marcada à mão por
--    quem administra (ex.: "ainda não é cliente" para quem comprou de outro
--    jeito), que vence a situação calculada pelas vendas.
-- 3. `grupos_mensagens_programadas` — mensagem para um ou vários grupos, uma
--    vez ou todo dia, com variação aleatória do horário (anti-banimento).
--    O cron `grupos-programadas` envia pelo mesmo caminho do atendente.

alter table public.vendas_externas add column if not exists renovacao boolean not null default false;

create table if not exists public.grupos_painel_marcacoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  telefone_chave text not null,
  situacao text not null check (situacao in ('nao_cliente', 'comprou', 'renovou')),
  marcado_por uuid,
  updated_at timestamptz not null default now(),
  unique (organization_id, telefone_chave)
);

create table if not exists public.grupos_mensagens_programadas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_ids uuid[] not null check (cardinality(conversation_ids) between 1 and 50),
  corpo text not null check (length(corpo) between 1 and 4000),
  frequencia text not null check (frequencia in ('unica', 'diaria')),
  -- Horário de Brasília (UTC-3) para a frequência diária, "HH:MM".
  horario text check (horario is null or horario ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- 0 = domingo … 6 = sábado. Vazio = todos os dias.
  dias_semana smallint[] not null default '{}',
  variacao_min smallint not null default 0 check (variacao_min between 0 and 120),
  proximo_envio timestamptz,
  ultimo_envio timestamptz,
  ultimo_resultado text,
  ativa boolean not null default true,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (frequencia = 'unica' or horario is not null)
);
create index if not exists grupos_mensagens_programadas_devidas_idx
  on public.grupos_mensagens_programadas (proximo_envio) where ativa;

alter table public.grupos_painel_marcacoes enable row level security;
alter table public.grupos_mensagens_programadas enable row level security;

drop policy if exists tenant_isolation_grupos_painel_marcacoes_select on public.grupos_painel_marcacoes;
create policy tenant_isolation_grupos_painel_marcacoes_select on public.grupos_painel_marcacoes
  for select to authenticated using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_grupos_mensagens_programadas_select on public.grupos_mensagens_programadas;
create policy tenant_isolation_grupos_mensagens_programadas_select on public.grupos_mensagens_programadas
  for select to authenticated using (organization_id in (select public.fn_user_org_ids()));

revoke insert, update, delete, truncate on public.grupos_painel_marcacoes, public.grupos_mensagens_programadas
  from anon, authenticated;
