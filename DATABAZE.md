# Databáze a uživatelské účty — návrh (30. 9. 2026)

Dnes appka drží všechno v `localStorage` jednoho zařízení a mezi zařízeními se
data přenášejí jen ručně zálohou. Tenhle návrh přidává **volitelný účet**: data
se synchronizují mezi telefonem, tabletem a počítačem a nezmizí se ztraceným
telefonem. Appka bez účtu funguje dál přesně jako teď.

Nejcitlivější místo je chvíle, kdy si účet založí někdo, kdo už appku používá
a má v telefonu měsíce dat. Ta data **musí skončit v jeho novém účtu** — nic se
nesmí ztratit ani zdvojit. Tomu je věnovaná celá kapitola 5 a je to jediná část,
která je už napsaná v kódu: [`src/lib/account-merge.ts`](src/lib/account-merge.ts)
s testy.

---

## 1. Doporučení: Supabase

**Supabase** = hostovaný Postgres + přihlašování + řízení přístupu po řádcích
(Row Level Security). Region **Frankfurt** (`eu-central-1`), ať data zůstanou v EU.

Rozhodlo jedno omezení, které vylučuje většinu ostatních cest: **appka nemá
server.** Je to statický export Next.js (`output: "export"`), který v telefonu
servíruje Capacitor ze souborů, a aktualizace chodí jako balík z GitHubu. Kdo
má data přijímat, musí to umět bez vlastního backendu — a přesně to RLS dělá:
appka mluví s databází napřímo a databáze sama pohlídá, že každý vidí jen svoje.

| | **Supabase** | Firebase | PocketBase | vlastní server (SQLite + Prisma) |
|---|---|---|---|---|
| Kde běží | hostované | hostované | vlastní VPS | vlastní VPS |
| Účty | v ceně (e-mail a heslo, Google, Apple) | v ceně | v ceně | napsat |
| Data | Postgres (SQL, JSON) | dokumenty (NoSQL) | SQLite | SQLite |
| Bez vlastního serveru | ano (RLS) | ano (pravidla) | ne | ne |
| Zdarma | 500 MB, 50 000 aktivních uživatelů / měsíc | ano, s limity čtení | platí se VPS | platí se VPS |
| Uzamčení u dodavatele | open source, jde provozovat i sám | Google | open source | žádné |

Firebase by fungoval taky, ale drží data jako dokumenty a jeho pravidla přístupu
jsou vlastní jazyk; Supabase je obyčejné SQL a jde kdykoli odnést jinam.
PocketBase a vlastní server potřebují stroj, který běží, aktualizuje se a platí
se — pro appku jednoho vývojáře zbytečná starost.

> **Původní návrh v NOTES.md (SQLite + Prisma + Server Actions) je mrtvý.**
> Server Actions ve statickém exportu neexistují a v telefonu žádný Node neběží.
> Šlo by to jen s odděleně hostovaným serverem, což je právě ta starost navíc.

**Háček free plánu:** projekt, do kterého týden nikdo nesáhne, se uspí. S pár
aktivními uživateli se to nestane (stačí pár dotazů denně), a když ano, appka
jede dál offline a synchronizace se chytí po probuzení projektu v dashboardu.
Placený plán se neuspává.

---

## 2. Architektura: offline napřed

```
 obrazovka ── StoreProvider ── localStorage          (jako dnes, pravda pro UI)
                   │ commit()
                   ▼
             deník změn  ── "co se změnilo a kdy"
                   │
                   ▼
              lib/sync.ts ── nahrát / stáhnout ──►  Supabase (Postgres + RLS)
```

- Všechno dál funguje bez sítě. Pravidla microwinů, procenta i rekordy běží
  v telefonu v `lib/` jako teď — databáze nic nepočítá, jen drží.
- Synchronizuje se po startu, po návratu do appky a pár sekund po změně.
- Nic z toho nepotřebuje nové APK: `@supabase/supabase-js` je čistý JavaScript
  přes HTTPS, takže celé to jde do telefonu balíkem živé aktualizace. To je
  důležité, protože nové APK nejde nainstalovat přes staré (podpisový klíč, viz
  [ANDROID.md](ANDROID.md)).

---

## 3. Schéma

Celé je v [`supabase/schema.sql`](supabase/schema.sql) — vložit do SQL Editoru
v Supabase a spustit. Jádro je jedna tabulka:

```sql
create table public.records (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null,  -- 'nodes' | 'tasks' | 'daySheets' | … | 'prefs'
  key        text        not null,  -- id záznamu; otisk "projekt|den"; list time boxu den
  data       jsonb,                 -- záznam, jak ho zná appka; null = smazaný
  changed_at timestamptz not null,  -- kdy se změnil v telefonu → rozhoduje konflikty
  updated_at timestamptz not null default now(),  -- kdy dorazil → kurzor stahování
  device_id  text,
  primary key (user_id, kind, key)
);
```

K tomu RLS (`user_id = auth.uid()`), trigger, který `updated_at` nastavuje
serverovým časem, funkce `push_records` na nahrávání a tabulka `profiles`.

### Proč jedna tabulka s JSONem, a ne tabulka na každou kolekci

Tabulky 1:1 podle `types.ts` (projekty, úkoly, záznamy, …) vypadají čistěji,
ale tady by škodily:

1. **Model se mění každý týden.** `STATE_VERSION` je za šest týdnů na 8 a úkol
   za poslední dny dostal `tracker`, `mapOffset`, projekt `hidden`. S tabulkami
   by každé nové pole znamenalo migraci databáze, kterou musí stihnout dřív,
   než do telefonů dorazí balík. S JSONem pole prostě projde — a se starými
   i novými tvary si už dnes poradí `parseState` v `storage.ts`.
2. **Cizí klíče a unikátnost by se praly s offline.** Záznamy dorazí v libovolném
   pořadí (úkol dřív než jeho projekt) a dva telefony můžou offline udělat
   věci, které se srovnají až po stažení. Pravidla hlídá `lib/` a má je
   otestovaná; databáze je nemusí znát.
3. **Jedna synchronizace pro všechno.** Stejný kód nahraje projekt, list time
   boxu i nastavení. Nová kolekce = nic nového v síťové vrstvě.

Cena: databáze sama neumí "součet záznamů za den" — ale ten počítá appka. Kdyby
bylo potřeba SQL nad daty (statistiky napříč uživateli), jdou nad `jsonb`
udělat pohledy. Objem je malý: běžný uživatel má tisíce řádků, ne miliony.

---

## 4. Synchronizace

- **Deník změn.** `commit()` ve `StoreProvider` porovná předchozí a nový stav.
  Akce mění jen dotčené objekty (ostatní drží identitu), takže změněné záznamy
  se najdou levně. Do `localStorage` se zapíše `druh:klíč → čas změny` a fronta
  k odeslání.
- **Nahrání**: fronta → `push_records`. Starší změna novější nepřepíše
  (podmínka přímo v SQL).
- **Stažení**: `records` s `updated_at` větším než poslední kurzor → do stavu
  se propíše to, co je novější než lokální změna.
- **Mazání** posílá náhrobek (`data = null`). Bez něj by smazaný projekt přišel
  zpátky z druhého zařízení, které o smazání ještě neví.
- **Konflikty se řeší po záznamech**, ne po celém stavu: dva telefony, které
  offline měnily různé věci, si obě změny nechají; stejný úkol na obou vyhraje
  novější změna.
- **Dvoje hodiny schválně.** `changed_at` je z telefonu (offline změna jiný čas
  nemá), `updated_at` ze serveru (stahování nesmí záviset na tom, jestli má
  někdo špatně nastavené hodiny).
- **Nastavení** (`prefs`) je jeden záznam `kind = 'prefs'`. **Klíč k AI nikdy** —
  zůstává v zařízení, stejně jako dnes nechodí do zálohy.

**Co se vyplatí udělat hned, ještě bez účtů:** začít psát deník změn. Až účty
přijdou, budou telefony u většiny věcí vědět, kdy se naposledy změnily, a při
převzetí (kap. 5) bude o to míň konfliktů, které se musí řešit naslepo.

---

## 5. Účty a převzetí dat ze zařízení

### Přihlášení

- **E-mail a heslo, žádné e-maily.** Účet vznikne hned při registraci, bez
  potvrzovacího mailu, a rovnou se do něj přihlásí. Proto v Supabase musí být
  vypnuté **Confirm email** (viz níž). Rozhodnuto 30. 9. 2026.
- Proč ne odkaz v mailu nebo Google: po přihlášení by musely otevřít appku,
  a to je nativní nastavení (deep link) = nové APK. Dá se přidat později
  spolu s nějakým APK, které půjde ven stejně.
- Veřejný (publishable) klíč v balíku je v pořádku — je veřejný z principu,
  přístup hlídá RLS. **Tajný klíč (`sb_secret_…` / `service_role`) nesmí do
  repozitáře nikdy**: repo i OTA balíky jsou veřejné.
- Účet je volitelný: Nastavení → Účet. Kdo ho nechce, nic se mu nemění.
- **Hotové:** dialog v Nastavení → Hlavní → Účet se záložkami Přihlásit se /
  Nový účet (`components/account/login-dialog.tsx`, logika v `lib/account.ts`).
  Dokud v `lib/account.ts` chybí adresa projektu a veřejný klíč, řekne, že
  účty ještě nejsou napojené, a nic neposílá.

**Co tím odpadá a co to stojí:**

- Žádné šablony e-mailů ani SMTP - Supabase nic neposílá, takže ani limit
  vestavěného e-mailu (2 zprávy za hodinu, jen členům týmu) se nás netýká.
- **Zapomenuté heslo si člověk sám neobnoví** - obnova chodí mailem. Do té
  doby jde heslo změnit jen ručně v dashboardu. Dialog to při registraci říká.
- **Adresa se neověřuje.** Kdokoli může založit účet na cizí e-mail; skutečný
  majitel pak na něj účet nezaloží. U appky, kde účet slouží jen k přenosu
  vlastních dat, je to přijatelné. Kdyby to začalo vadit, zapne se Confirm
  email a přidá SMTP - kód appky se nemění.

### Nastavení v Supabase

**Authentication → Sign In / Providers:**

- **Confirm email** - **vypnout** (přepínač v části User Signups, případně po
  rozkliknutí providera Email). Jinak registrace skončí na čekání na mail,
  který nikdo nepošle - appka to pozná a řekne, co přepnout.
- **Allow new users to sign up** - nechat zapnuté.
- Provider **Email** - zapnutý (výchozí).
- Minimální délka hesla zůstává výchozích 6 znaků; appka hlídá totéž.

### Komu data v telefonu patří

Zařízení si pamatuje vlastníka dat: `microwins:owner` = nic (data bez účtu)
nebo id účtu. Podle toho se rozhoduje, co při přihlášení udělat:

| Situace | Co se stane |
|---|---|
| **A.** Telefon bez dat, nový účet | není co převzít |
| **B.** Telefon s daty, **nový** účet | všechno z telefonu se nahraje do účtu, id beze změny |
| **C.** Telefon s daty, účet **už data má** (z jiného zařízení) | sloučení: co je jen v telefonu, přibude; co je na obou stejné, zůstane jednou; viz pravidla níž |
| **D.** Znovu přihlášení téhož účtu | běžná synchronizace |
| **E.** V telefonu jsou data **jiného** účtu | **nic se samo neslučuje.** Dialog: nechat je stranou, nebo je ze zařízení smazat. Jinak by se data jednoho člověka vylila do účtu druhého. |
| **F.** Odhlášení | data zůstanou v telefonu, patří dál tomu účtu; přihlášení jiného účtu = E |

### Pravidla sloučení (případ B i C) — `mergeIntoAccount`

Napsané a otestované v [`src/lib/account-merge.ts`](src/lib/account-merge.ts):

- **Id se nepřerážejí.** Na rozdíl od importu „Přidat" (ten id přeráží, aby se
  cizí záloha nepotkala s domácími daty) je tady id jediné, podle čeho se pozná,
  že projekt na tabletu a projekt v účtu je tentýž — tablet ho mohl dostat
  obnovou zálohy z telefonu. Přeražená id by ho zdvojila.
- **Co je jen v telefonu, přibude.** Projekty a ToDo se zařadí **za** ty z účtu,
  aby se dva ručně seřazené seznamy neprolnuly.
- **Co je na obou stejné, zůstane jednou.** Rozdílné pořadí se za rozdíl
  nepočítá — pořadí se bere z účtu.
- **Stejné id, jiný obsah = konflikt.** Vyhraje novější změna podle deníku
  změn (kap. 4). Když čas chybí, vyhraje účet: to je verze, kterou už vidí
  ostatní zařízení. Prohraná verze se nezahodí potichu — konflikt se vypíše
  v náhledu a verze z telefonu je v záloze před sloučením.
- **Listy time boxu se slévají**, protože je psal člověk rukou: prázdná
  priorita se doplní, obsazenou nic nepřepíše a ta z telefonu se připíše do
  brain dumpu, stejně jako jeho text. Kdyby spojený brain dump přetekl limit,
  zůstane list z účtu a den se nahlásí (oříznout = tiše ztratit konec).
- **Microwin je nejvýš jeden na win a den**; ze dvou zařízení zůstane vyšší.
- **Opakování je bezpečné.** Druhé převzetí téhož nic nepřidá ani nezmění —
  když spojení spadne uprostřed nahrávání, dá se to celé pustit znovu.

### Postup při přihlášení

1. Stáhnout celý stav účtu.
2. **Záloha před sloučením**: soubor `microwins-pred-prihlasenim-<datum>.json`
   (stejnou cestou jako dnešní export) a kopie v `localStorage`. Nejhorší případ
   se vrátí přes „Obnovit ze souboru".
3. `mergeIntoAccount(účet, telefon, časy změn)` a **náhled**: „Do účtu přibude
   7 projektů, 312 záznamů, 45 microwinů. 2 věci se lišily — nechána verze
   z účtu." Potvrzením se pokračuje.
4. Nahrát výsledek (`push_records`).
5. Stav v telefonu := sloučený stav, `microwins:owner` := účet,
   `profiles.adopted_at` := teď.

---

## 6. Bezpečnost a soukromí

- RLS na obou tabulkách; bez přihlášení se z databáze nepřečte nic.
- E-mail je osobní údaj → region EU. Smazání účtu smaže i data (`on delete
  cascade`); export dat umí appka už dnes.
- Klíč k AI se nesynchronizuje, service role klíč nesmí do repa.

---

## 7. Postup práce

| Krok | Co | Stav |
|---|---|---|
| 0 | Pravidla převzetí dat do účtu + testy (`account-merge.ts`) | **hotovo** |
| 1 | Nastavení → Účet: registrace a přihlášení heslem, odhlášení (`lib/account.ts`, `login-dialog.tsx`) | **hotovo** |
| 2 | Supabase projekt `mgxbvayypbrrbdzurgcj`: schéma spuštěné, Confirm email vypnuté | **hotovo** (ověřeno 30. 9. 2026) |
| 3 | Deník změn (`journal` v `sync-engine.ts`, volá ho `commit` ve StoreProvideru) | **hotovo** |
| 4 | Synchronizace: `lib/sync.ts` (záznamy, rozdíly), `lib/sync-engine.ts` (pravidla), `lib/sync-runtime.ts` (Supabase, kdy se synchronizuje) | **hotovo**, ověřeno proti podvrženému serveru |
| 5 | Převzetí dat po přihlášení (`components/account/adopt-dialog.tsx`): Spojit / Teď ne / vzít jen účet, případ E | **hotovo** |
| 6 | Nastavení appky (`prefs`) mezi zařízeními | zatím ne - každé zařízení má svoje |
| 7 | Živé změny z jiného zařízení (Supabase Realtime) | volitelné |

**Jak to teď běží:**

- Synchronizuje se po přihlášení, po startu appky, 2 s po každé změně, po
  návratu do appky, po obnovení připojení a každé 2 minuty, dokud je appka
  vidět. Ručně jde Nastavení → Účet → Synchronizovat.
- Pořadí ve stromu má vlastní záznam `nodeOrder:nodes` (pořadí uzlů je pořadí
  v poli, uzly samy o něm nevědí).
- Stahuje se s minutovým přesahem za kurzor - co už v zařízení je, se znovu
  nepropíše.
- Po přihlášení se zařízením s daty vyskočí okno „Spojit data s účtem" s
  náhledem. Volby: **Spojit**, **Teď ne** (v Nastavení → Účet pak zůstane
  tlačítko), nebo **vzít jen data z účtu** (pro zkušební data - do účtu z nich
  nejde nic). Před každou volbou se data zařízení odloží do
  `localStorage["microwins:pre-account"]` a jdou uložit i do souboru.
- Prázdné zařízení převezme účet bez ptaní.
- Když se kontrola po přihlášení nepovede (bez signálu), zkusí se znovu při
  dalším připojení nebo návratu do appky.

**Ke kroku 2 - co udělat a co poslat:**

1. Na [supabase.com](https://supabase.com) založit projekt (free plán stačí),
   region **Central EU (Frankfurt)**. Heslo k databázi si ulož, ale neposílej.
2. **SQL Editor** → vložit celý `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers** → vypnout **Confirm email**
   (viz „Nastavení v Supabase" výš).
4. Poslat mi obojí z tlačítka **Connect** nahoře v projektu (klíče jsou i
   v **Settings → API Keys**):
   - **Project URL** - `https://<něco>.supabase.co`
   - **Publishable key** - `sb_publishable_…` (starší `anon` klíč začínající
     `eyJ…` by fungoval taky, ale Supabase ho do konce roku 2026 ruší)

   Oba jsou veřejné a do repozitáře smějí. **Nikdy neposílej** secret key
   (`sb_secret_…`), `service_role` ani heslo k databázi.
