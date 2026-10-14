# Architektura synchronizace a řešení kolizí (MicroWins)

Tento dokument popisuje funkčnost lokálního ukládání, offline synchronizace a řešení konfliktů v aplikaci **MicroWins (MW)**.

---

## 1. Hlavní principy

- **Offline-First:** Všechny uživatelské akce se okamžitě zapíší do lokálního stavu v `localStorage` (`microwins:v1`). Aplikace funguje 100% offline bez připojení k internetu.
- **Granulární záznamy (`druh:id`):** Místo uložení celého stavu v jednom JSONu se do Supabase databáze (`records`) posílá každý uzel, úkol, ToDo položka nebo timebox blok samostatně.
- **Offline deník (`outbox`):** Změny vzniklé v offline režimu se evidují v outboxu pod klíčem `druh:id → čas_změny` a po obnovení sítě se odešlou na server.
- **Last-Write-Wins (LWT) & Slévání:** Kolize na stejném záznamu vyhrává novější časové razítko (`changed_at`). U vybraných entit (listy Timeboxu) probíhá inteligentní slévání obsahu (spojení textů Brain Dumpu) - při převzetí dat po přihlášení i při běžné synchronizaci.

### Slévání listů Timeboxu při běžné synchronizaci

Když se list téhož dne změní na dvou zařízeních dřív, než se stihnou synchronizovat, nevyhrává ani jedna verze. `mergeDaySheet` v `sync.ts` je spojí:

- Základem je novější verze. Její priority i text brain dumpu zůstanou beze změny.
- Prázdná priorita se doplní ze starší verze. Když je priorita obsazená na obou zařízeních a liší se, zůstane ta novější a starší se připíše do brain dumpu jako `• text`.
- Řádky brain dumpu ze starší verze, které v novější chybí, se připíšou na konec.
- Kdyby spojený text přesáhl limit (`BRAIN_DUMP_MAX`), slévání se vzdá a vyhraje novější verze.

Výsledek se uloží do zařízení a odešle se s časem novějším než obě verze, takže ho převezmou všechna zařízení.

Spojí se jen opravdu nová cizí verze. Jinak by se do textu vracely řádky, které člověk na zařízení mezitím smazal. Proto se neslévá:

- **vlastní ozvěna** - záznam se stejným `device_id`, jaký posílá toto zařízení,
- **záznam stažený už minule** - `updated_at` není novější než kurzor (stahuje se s minutovým přesahem).

Omezení: když se řádek smaže jen na jednom zařízení a druhé ho mezitím mělo v rozepsané verzi, po slití se vrátí. Je to záměr - radši řádek navíc než ztracený text.

---

## 2. Povinný účet, offline a konflikty (od 14. 10. 2026)

- **Bez účtu appka nejede.** `AuthGate` (`components/account/login-screen.tsx`) pustí do appky jen přihlášeného. Lokální zálohy (export/import do souboru) padly - zdrojem pravdy je databáze účtu, `localStorage` je její kopie pro práci bez signálu.
- **Appka nikoho sama neodhlásí - ani po letech offline.** Kdo je přihlášený, si drží sama (`microwins:account`, `lib/account.ts`), nezávisle na tokenech Supabase; smaže to jen tlačítko Odhlásit. Prošlý token bez sítě nevadí (obnoví se po spojení). Když databáze přihlášení opravdu zruší (změna hesla, zneplatněný token), appka jede dál, změny čekají v telefonu a Nastavení → Účet nabídne „Přihlásit znovu“; synchronizace se po něm rozjede sama.
- **První přihlášení na zařízení s daty** jde přes převzetí (`account-merge.ts`): data se spojí s účtem, nic se na serveru nemaže.

### Jak se řeší konflikty

| Situace | Výsledek |
|---|---|
| Dvě zařízení mění **různé** věci | Přežije obojí (záznamy jsou po jednom). |
| Dvě zařízení mění **tutéž** věc | Vyhraje novější změna (`changed_at`), na serveru i v telefonech. |
| Jedno věc **smaže**, druhé ji **upraví** | Taky novější vyhrává: pozdější úprava věc vrátí, pozdější smazání ji vezme i s úpravou. |
| List time boxu téhož dne na dvou zařízeních | Slije se (`mergeDaySheet`), nic z textu se neztratí. |
| Dlouho bez signálu | Fronta drží poslední podobu každé věci; po spojení odejde jednou (po 500 záznamech). |

Všechno je otestované proti serveru v paměti se dvěma „telefony“ (`sync-engine.test.ts`).

**Známé riziko: hodiny zařízení.** `changed_at` dává zařízení podle svých hodin. Telefon s hodinami napřed vyhraje i nad pozdější změnou jinde, telefon pozadu prohraje. U telefonů se síťovým časem je to vzácné. Pojistka na serveru by byla v `push_records` brát `least(changed_at, now())` - je to změna funkce, žádná data nemaže, ale nasadit ji musí vlastník projektu v Supabase.

## 3. Přehled modulů

- **`src/lib/storage.ts`**: Čtení a zápis stavu do `localStorage`.
- **`src/lib/sync.ts`**: Rozklad stavu aplikace na jednotlivé záznamy a výpočet diffů (`diffStates`).
- **`src/lib/sync-engine.ts`**: Řízení synchronizace, fronta neodeslaných změn (`outbox`), metody `pull` a `push`.
- **`src/lib/sync-runtime.ts`**: Síťové napojení na Supabase, automatické spouštěče (debounce 2s, focus, interval 2 min).
- **`src/lib/account-merge.ts`**: Algoritmy pro převzetí dat ze zařízení a slévání při přihlášení.

---

## 4. Testovací sada

Funkčnost offline ukládání a řešení kolizí je ověřena automatickými testy:
- `src/lib/sync.test.ts`
- `src/lib/sync-engine.test.ts`
- `src/lib/account-merge.test.ts`

Spuštění testů: `npm run test`
