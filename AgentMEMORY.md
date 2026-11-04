# AgentMEMORY — MicroWins
Aktualizováno: 2026-11-04 14:01

## Cíl repa
Android a webová appka na cíle a den: projekty, strom winů, ToDo, time box, atomy. Data v účtu Supabase, kopie v zařízení.

## Stav a jak spustit
- `npx vitest run` (462 testů), `npm run dev`; APK a OTA viz `ANDROID.md`.
- Repo https://github.com/MonsterMarian/MicroWins, větev `main`, píše do ní i někdo jiný: před pushem pull.

## Hotovo
- 2026-11-04 — Průchod appkou v Chromu, opravené bugy: fokus v dialozích (Popis se psal do Nadpisu atomu), Váha a krok nešly přepsat (1 → 15), váha 0 se dialogem měnila na 1, „+-13,7 %“ v přehledu, Zpět po smazání úkolu, převěšení kusu pod úkol s postupem, zámek rolování po Zpět, Enter v Zadat hodnotu, přejetí mezi sekcemi skutečným dotykem.
- 2026-11-04 — `NOTES.md` a `README.md` srovnané se stavem kódu: pryč zrušené zálohy, záložka Plán a týdenní pohled, přidaný kalendář a účty.

## Rozpracováno
- Na telefonu neověřeno: přejetí mezi sekcemi (ověřeno emulovaným dotykem v Chromu), `touch-action` ve WebView.

## Další kroky
- Rozhodnout s uživatelem: rozsekání úkolu s postupem dělá kopii se stejným názvem a procenta se půlí (71 % → 35 %). Je to zdokumentované chování, ne chyba.
- Formuláře se při stažení změn nově nevynulují; ověřené jen čtením kódu, ne proti serveru.

## Rozhodnutí a poznámky
- V `NOTES.md` jsem neověřoval každý řádek tabulky rozhodnutí, jen místa se zrušenými funkcemi. Komentář v `timeblocks.ts` „žádné napojení na kalendář“ je zastaralý.

## Log (posledních ~30)
- 2026-11-04 14:01 — „otestuj MW a mpL v prohlížeči, najdi bug v projektech“ → 10 oprav, 463 testů, klikač 4 100+ kroků bez pádu, balík OTA; poslední regresní běh ukončil systém pro nedostatek paměti.
- 2026-11-04 12:29 — „updejtni MD soubory“ → NOTES a README opravené; 462 testů prošlo, žádný balík (jen dokumentace).
