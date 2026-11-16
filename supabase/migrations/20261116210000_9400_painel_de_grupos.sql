-- manifest: **Painel de Grupos: membros de cada grupo do WhatsApp, vendas externas (Kiwify) e conversão por grupo.**
--
-- Três tabelas, todas tenant-aware, escritas SÓ pelo servidor (service role):
--
-- 1. `grupos_painel` — os grupos que o número participa, com a chave
--    "acompanhar" e o código de origem do link de venda (`?src=grupo10`).
-- 2. `grupos_painel_membros` — retrato dos participantes de cada grupo, tirado
--    do WAHA na sincronização. `telefone_chave` é o número normalizado para o
--    cruzamento com a venda (DDD + 8 últimos dígitos no Brasil, porque o
--    WhatsApp de conta antiga não traz o nono dígito).
-- 3. `vendas_externas` — vendas recebidas de plataforma de infoproduto
--    (Kiwify), pelo webhook ou pela importação da planilha. Idempotente por
--    (organização, plataforma, id externo).
-- 4. `vendas_externas_fontes` — o segredo do caminho do webhook por
--    organização. O caminho resolve a organização; o corpo nunca.

create table if not exists public.grupos_painel (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete cascade,
  group_chat_id text not null check (group_chat_id ~ '^[0-9-]+@g\.us$'),
  subject text,
  acompanhar boolean not null default false,
  codigo_origem text check (codigo_origem is null or codigo_origem ~ '^[a-z0-9_-]{1,40}$'),
  sou_admin boolean,
  membros_total integer,
  sincronizado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel_session_id, group_chat_id)
);
create unique index if not exists grupos_painel_codigo_origem_uq
  on public.grupos_painel (organization_id, codigo_origem) where codigo_origem is not null;

create table if not exists public.grupos_painel_membros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  grupo_id uuid not null references public.grupos_painel(id) on delete cascade,
  participante_id text not null,
  telefone text,
  telefone_chave text,
  admin boolean not null default false,
  visto_em timestamptz not null default now(),
  unique (grupo_id, participante_id)
);
create index if not exists grupos_painel_membros_org_chave_idx
  on public.grupos_painel_membros (organization_id, telefone_chave);

create table if not exists public.vendas_externas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plataforma text not null default 'kiwify' check (plataforma in ('kiwify')),
  id_externo text not null,
  status text not null check (status in ('paga', 'reembolsada', 'chargeback', 'recusada', 'pendente')),
  produto text,
  cliente_nome text,
  cliente_email text,
  cliente_telefone text,
  telefone_chave text,
  valor_cents integer,
  valor_liquido_cents integer,
  moeda text not null default 'BRL',
  origem_src text,
  codigo_grupo text,
  comprado_em timestamptz,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, plataforma, id_externo)
);
create index if not exists vendas_externas_org_chave_idx on public.vendas_externas (organization_id, telefone_chave);
create index if not exists vendas_externas_org_codigo_idx on public.vendas_externas (organization_id, codigo_grupo);

create table if not exists public.vendas_externas_fontes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plataforma text not null default 'kiwify' check (plataforma in ('kiwify')),
  segredo_caminho text not null unique check (length(segredo_caminho) >= 32),
  -- O "token" que a Kiwify usa para assinar (`?signature=` = HMAC-SHA1 do corpo).
  -- Opcional: sem ele, o segredo do caminho é a única trava.
  token_assinatura text,
  created_at timestamptz not null default now(),
  unique (organization_id, plataforma)
);

alter table public.grupos_painel enable row level security;
alter table public.grupos_painel_membros enable row level security;
alter table public.vendas_externas enable row level security;
alter table public.vendas_externas_fontes enable row level security;

-- Leitura para quem é da organização; escrita só pelo servidor (sem policy de
-- escrita para `authenticated`, e o service role ignora RLS).
drop policy if exists tenant_isolation_grupos_painel_select on public.grupos_painel;
create policy tenant_isolation_grupos_painel_select on public.grupos_painel
  for select to authenticated using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_grupos_painel_membros_select on public.grupos_painel_membros;
create policy tenant_isolation_grupos_painel_membros_select on public.grupos_painel_membros
  for select to authenticated using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_vendas_externas_select on public.vendas_externas;
create policy tenant_isolation_vendas_externas_select on public.vendas_externas
  for select to authenticated using (organization_id in (select public.fn_user_org_ids()));
-- `vendas_externas_fontes` guarda segredo: nenhuma policy, só o servidor lê.

revoke insert, update, delete, truncate on public.grupos_painel, public.grupos_painel_membros,
  public.vendas_externas, public.vendas_externas_fontes from anon, authenticated;
revoke all on public.vendas_externas_fontes from anon, authenticated;
