# Zadání z poznámek (16. 8. 2026)

Čtyři požadavky nadiktované do BetterNotes v telefonu. Každý má popis toho,
co se má stát, kde to v kódu sedí a podle čeho se pozná, že je hotovo.

---

## 1. Pryč s PushWinem

**Poznámka:** „Zruš tu funkci co unlokneš za 50 microwin a vše co s ní
souvisí, rozhodl jsem se, že je až moc."

Týdenní výzva se odemyká po 50 microwinech (`PUSHWIN_UNLOCK`
v [src/lib/pushwin.ts](src/lib/pushwin.ts)). Má zmizet celá, ne se jen skrýt —
včetně stavu v úložišti, nastavení a dokumentace.

**Kde to je:**

| Soubor | Co v něm je |
|---|---|
| `src/lib/pushwin.ts` + `pushwin.test.ts` | doména a testy |
| `src/components/pushwin/pushwin-card.tsx` | obrazovka výzvy |
| `src/components/providers/store-provider.tsx` | stav a akce |
| `src/components/settings-dialog.tsx` | sekce v Nastavení |
| `src/lib/prefs.ts` | volby |
| `src/app/tree/page.tsx`, `src/components/tree/node-dialog.tsx`, `src/components/stats/heatmap.tsx` | zobrazení výzvy |
| `src/lib/date.ts`, `src/lib/dev-seed.ts`, `src/app/globals.css` | pomocné kousky a styly |
| `PUSHWIN.md` | dokumentace |

**Hotovo, když:** `grep -ri pushwin src/` nic nenajde, testy procházejí,
appka se nastartuje se starým uloženým stavem (kde pushwin data ještě jsou)
a nespadne na tom — čtení stavu má cizí klíče prostě zahodit.

---

## 2. Kolečko dní se má u hotového projektu zastavit

**Poznámka:** „V aplikaci jsem měl úkol na 30 dní a dokončil jsem ho dříve.
Chci, aby v moment, kdy na projektu hitnu 100 %, se ten počet dní zastavil,
takže kolečko bude full a bude tam jen to číslo, např. 26 — žádné 26/30."

Na obrazovce statistik projektu jsou tři kolečka: Postup, Dny, Hotové úkoly
([src/components/projects/project-analytics.tsx:88](src/components/projects/project-analytics.tsx)).
Dnes prostřední kolečko dál počítá k termínu, i když je projekt na 100 %:
ukazuje `26` a pod tím `z 30`, prstenec není dokreslený.

**Chování po změně** — jakmile je postup 100 %:

- prstenec kolečka Dny je celý (hodnota 100, ne poměr k termínu),
- uvnitř je jen počet dní, které to trvalo (`26`),
- řádek `z 30` zmizí.

Nedokončený projekt zůstává, jak je: `26` / `z 30` a částečný prstenec.

**Hotovo, když:** projekt na 100 % ukazuje plné kolečko s jedním číslem,
projekt na 60 % vypadá jako dřív, a pokrývá to test v `src/lib/`.

---

## 3. Koš u ToDo nesmí mazat na první klepnutí

**Poznámka:** „Chci, aby se ten todo nesmazal, když se klikne na koš hned —
už se mi to párkrát stalo omylem a to není ready."

[src/components/projects/todo-panel.tsx:224](src/components/projects/todo-panel.tsx)
volá `deleteTodo(todo.id)` rovnou z `onClick`. Ikona koše sedí vedle tužky
v úzkém řádku, takže se trefí omylem — a položka je pryč bez cesty zpátky.

**Řešení:** smazat, ale nabídnout vrácení. Po smazání vyskočí hláška
s tlačítkem **Vrátit**, které položku vrátí i s pořadím a stavem
odškrtnutí. Když se do pár sekund nic nestane, zmizí to nadobro.

Potvrzovací dialog je druhá možnost, ale horší: seznam na dnešek se maže
často a dialog by překážel pokaždé, zatímco překlep se stane jednou za čas.

**Hotovo, když:** klepnutí na koš položku odstraní ze seznamu, hláška
nabídne vrácení, vrácená položka sedí na svém původním místě.

---

## 4. Tlačítko „hotovo", zapínatelné addony, pořadí záložek

**Poznámka:** „Tlačítko hotovo dej defaultně to první a ostatní možnosti
odstraň z nastavení. Do nastavení přidej addony, které budou on-off. První
z nich je ta sekce ToDo. V projektech, jak je ta sekce přehled, todo
a projekty, tak chci, abych mohl měnit pořadí — jako co je vlevo, co vpravo."

Tři samostatné věci:

**4a. Jedna podoba tlačítka hotovo.** Dnes je jich pět, přepínají se
v Nastavení ([done-button.tsx](src/components/projects/done-button.tsx),
volba `doneStyle` v `src/lib/prefs.ts`, náhled `DoneButtonPreview`
v `settings-dialog.tsx`). Zůstane první podoba jako jediná, přepínač
z Nastavení pryč, ostatní varianty z kódu pryč.

**4b. Addony on/off.** Nová sekce v Nastavení, kde se jednotlivé části appky
zapínají a vypínají. První addon je **ToDo**: když je vypnutý, zmizí záložka
i její obsah a appka se chová, jako by ToDo nebylo. Sekce má být napsaná tak,
aby přidání druhého addonu byl jeden řádek, ne přepis.

**4c. Pořadí záložek.** Záložky Přehled / ToDo / Projekty jsou natvrdo
v [projects-hub.tsx:39](src/components/projects/projects-hub.tsx). Uživatel
si má pořadí přeskládat v Nastavení a to pořadí drží.

**Hotovo, když:** v Nastavení je jeden seznam addonů a jedno přeskládání
záložek, tlačítko hotovo nemá volby, vypnuté ToDo nikde nesvítí a přeskládané
pořadí přežije restart appky.

---

## Poznámka k doručení

Všechno výše je čistě `src/`, takže to jde do telefonu **balíčkem živé
aktualizace** (`npm run ota:bundle` + push). Nové APK potřeba není — a ani
by nešlo nainstalovat, viz podpisové klíče v [ANDROID.md](ANDROID.md).
