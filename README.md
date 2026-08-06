# MicroWins

Dvě propojené věci v jedné aplikaci:

1. **Projekty** - velké cíle rozsekané na měřitelné úkoly, postup v procentech, deadline, tempo, graf vývoje a deník změn.
2. **Strom microwinů** - stromová evidence denních rekordů. Microwin padne ve chvíli, kdy dnešek překoná dosavadní rekord.
3. **Analýza** - série (streaky), kalendář microwinů, rekordy podle metrik a tempo projektů.

Data žijí lokálně v prohlížeči (`localStorage`), takže aplikace funguje offline a bez účtu. Export i import je v dialogu **Data** v hlavičce.

---

## Spuštění

```bash
npm install
```

```bash
npm run dev
```

Aplikace běží na `http://localhost:3000`. První spuštění nabídne načtení ukázkových dat.

| Skript | Co dělá |
|---|---|
| `npm run dev` | vývojový server |
| `npm run build` | produkční build |
| `npm run test` | testy doménové logiky (Vitest) |
| `npm run type-check` | `tsc --noEmit` |
| `npm run ci:validate` | typy + testy |

---

## Část 1 - strom úspěchů

Strom má libovolnou hloubku. Uzel je buď **kategorie** (může obsahovat další kategorie i metriky), nebo **metrika** (list, drží text a záznamy).

```
- Business
-- cold calls
--- X cold calls za den
    [2; 1. 1. 2026]
    [4; 5. 6. 2026]
- Fitness
-- X tréninku            (jednotka H)
```

Text metriky obsahuje zástupné **X**. Všude v přehledech se X nahradí hodnotou daného dne:
`X cold calls za den` + hodnota 4 → **„4 cold calls za den"**.

### Pravidla zápisu

| Pravidlo | Chování |
|---|---|
| Hodnota | vždy číslo **> 0**, klidně desetinné (`2,5 H`) |
| Nula | ignoruje se, nic se nezapíše (není to chyba) |
| Záporná hodnota | chyba, zápis neprojde |
| Datum | výchozí je **dnešek**, lze zadat i starší den |
| Budoucnost | zapsat nejde |
| Denní součet | víc zápisů ve stejném dni se sečte (`2 + 3 = 5`); metrika se dá přepnout na režim „nejlepší pokus" |
| Rekord | nejvyšší **denní součet** napříč všemi dny |
| **Microwin** | zápis **k dnešku**, po kterém dnešní součet překoná dosavadní rekord |
| První zápis | rekord byl 0, takže první zápis metriky je vždy microwin |
| Zpětný zápis | microwin **nedává** - může ale posunout rekord, protože rekord je vlastnost dne |
| Jeden den, jedna metrika | nejvýš jeden microwin; když se výkon během dne zlepší, microwin se aktualizuje |

Zpětný zápis, který přeskočí dnešní výkon, dnešní microwin odebere - rekord byl ve skutečnosti vyšší. Minulé microwiny se nepřepisují, jsou to získané fakty.

---

## Část 2 - statistiky

- **Tabulka dnů** - kolik microwinů padlo který den, u každého text metriky s dosazenou hodnotou a informace, jaký rekord se překonal.
- **Série (streak)** - kolik dní v řadě padl aspoň jeden microwin. Aplikace rozlišuje sérii uzavřenou dneškem a sérii, které dnešek ještě chybí („visí na vlásku").
- **Kalendář** - 18 týdnů zpět, sytost políčka = počet microwinů.
- **Rekordy podle metrik** - rekord, jeho datum, dnešní stav a kolik chybí.
- **Rozložení podle oblastí** - kde microwiny opravdu padají.

---

## Projekty

- **Projekt**: ikona, start, deadline (nebo bez něj), popis, ruční pořadí, archiv.
- **Úkol**: číselný cíl (`630 / 2000`), jednotka, krok tlačítek +/-, váha v projektu, termín, milník, popis, podúkoly.
- **Postup**: úkol = `hotovo / cíl`; úkol s podúkoly = vážený průměr podúkolů; projekt = vážený průměr top-level úkolů.
- **Tempo**: kolik procent denně zbývá do deadlinu.
- **Historie**: každá změna hodnoty zapíše denní otisk postupu - z toho vzniká graf i deník změn (`62 % → 65 %  +3 %`).
- **Milníky**: mezizastávky projektu, úkol se k nim dá přiřadit.
- Záložky **Přehled / Projekty / Úkoly / Dnes**, filtry, řazení a hledání.

---

## Struktura

```
src/
  app/                      routy (App Router, vše klientské)
    page.tsx                projekty (rozcestník se záložkami)
    projects/[id]/          detail projektu + jeho statistiky
    tasks/[id]/             detail úkolu
    tree/                   strom microwinů + dnešek
    stats/                  analýza (série, kalendář, tempo projektů)
  components/
    ui/                     primitiva ve stylu shadcn/ui
    charts/                 prstenec, plošný graf, denní sloupce (čisté SVG)
    projects/               projektová část
    tree/                   strom a zápis záznamů
    stats/                  statistiky microwinů
  lib/
    types.ts                datový model
    domain.ts               pravidla microwinů (čisté funkce)
    actions.ts              přechody stavu stromu
    projects.ts             výpočty postupu projektů
    project-actions.ts      přechody stavu projektů
    stats.ts                série, tabulka dnů, kalendář
    storage.ts              localStorage + export/import
    seed.ts                 ukázková data
```

Doménová logika je oddělená od Reactu, takže je testovatelná: `src/lib/actions.test.ts` a `src/lib/projects.test.ts` pokrývají pravidla microwinů i výpočty projektů (44 testů).

---

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Vitest.

Grafy jsou ručně kreslené SVG bez knihoven. UI primitiva sedí na konvenci shadcn/ui (`components.json`, CSS proměnné, `cn()`), takže se dají později vyměnit za komponenty z 21st.dev bez zásahu do volání.

### Barvy

Neutrální paleta a dva sémantické akcenty: **jantar** = microwin / rekord, **zelená** = postup projektu. Světlý i tmavý režim, přepínač v hlavičce.
