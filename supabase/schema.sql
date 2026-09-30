-- MicroWins - schéma databáze pro účty a synchronizaci (návrh, viz DATABAZE.md).
--
-- Vložit do Supabase → SQL Editor → Run. Nic tu není závislé na pořadí
-- spuštění kromě toho, co je napsané níž pod sebou.
--
-- Jedna tabulka `records` drží všechno, co dnes appka drží v localStorage:
-- řádek = jeden záznam jedné kolekce z `MicroWinsState` (projekt, úkol,
-- položka ToDo, blok plánu, list time boxu, …) jako JSON. Proč ne tabulka
-- na kolekci, rozebírá DATABAZE.md.

-- --- záznamy -----------------------------------------------------------------

create table if not exists public.records (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  -- kolekce z MicroWinsState ('nodes', 'tasks', 'daySheets', …) nebo 'prefs'
  kind       text        not null,
  -- id záznamu; otisky postupu "projekt|den" / "úkol|den", list time boxu den
  key        text        not null,
  -- záznam přesně tak, jak ho zná appka; null = smazaný (náhrobek)
  data       jsonb,
  -- kdy se záznam změnil v telefonu - rozhoduje konflikty mezi zařízeními
  changed_at timestamptz not null,
  -- kdy dorazil na server - podle toho se stahují novinky (nastavuje trigger)
  updated_at timestamptz not null default now(),
  -- které zařízení ho poslalo; jen pro ladění
  device_id  text,
  primary key (user_id, kind, key)
);

create index if not exists records_pull on public.records (user_id, updated_at);

alter table public.records enable row level security;

-- Každý vidí a mění jen svoje. Díky tomu smí být v appce veřejný anon klíč -
-- repozitář i OTA balíky jsou veřejné, takže nic tajného v nich být nesmí.
drop policy if exists "vlastni zaznamy" on public.records;
create policy "vlastni zaznamy" on public.records
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Čas příchodu dává server. Hodinám v telefonu se pro stahování věřit nedá:
-- špatně nastavené hodiny by jinak schovaly změnu před ostatními zařízeními.
create or replace function public.records_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
  before insert or update on public.records
  for each row execute function public.records_touch();

-- Nahrání změn. Starší změna novější nepřepíše - to je celé řešení konfliktů
-- mezi dvěma telefony, které se měnily offline: po záznamech vyhrává
-- poslední změna. Obyčejný upsert z klienta tuhle podmínku neumí, proto RPC.
create or replace function public.push_records(rows jsonb)
returns void
language sql
security invoker
as $$
  insert into public.records (user_id, kind, key, data, changed_at, device_id)
  select auth.uid(), r.kind, r.key, r.data, r.changed_at, r.device_id
  from jsonb_to_recordset(rows)
    as r (kind text, key text, data jsonb, changed_at timestamptz, device_id text)
  on conflict (user_id, kind, key) do update
    set data       = excluded.data,
        changed_at = excluded.changed_at,
        device_id  = excluded.device_id
    where public.records.changed_at < excluded.changed_at;
$$;

-- --- profil ------------------------------------------------------------------

create table if not exists public.profiles (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- kdy se do účtu převzala data ze zařízení (DATABAZE.md, "Převzetí dat")
  adopted_at timestamptz
);

alter table public.profiles enable row level security;

drop policy if exists "vlastni profil" on public.profiles;
create policy "vlastni profil" on public.profiles
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
