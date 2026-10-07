# Architektura synchronizace a řešení kolizí (MicroWins)

Tento dokument popisuje funkčnost lokálního ukládání, offline synchronizace a řešení konfliktů v aplikaci **MicroWins (MW)**.

---

## 1. Hlavní principy

- **Offline-First:** Všechny uživatelské akce se okamžitě zapíší do lokálního stavu v `localStorage` (`microwins:v1`). Aplikace funguje 100% offline bez připojení k internetu.
- **Granulární záznamy (`druh:id`):** Místo uložení celého stavu v jednom JSONu se do Supabase databáze (`records`) posílá každý uzel, úkol, ToDo položka nebo timebox blok samostatně.
- **Offline deník (`outbox`):** Změny vzniklé v offline režimu se evidují v outboxu pod klíčem `druh:id → čas_změny` a po obnovení sítě se odešlou na server.
- **Last-Write-Wins (LWT) & Slévání:** Kolize na stejném záznamu vyhrává novější časové razítko (`changed_at`). U vybraných entit (listy Timeboxu) probíhá inteligentní slévání obsahu (spojení textů Brain Dumpu).

---

## 2. Přehled modulů

- **`src/lib/storage.ts`**: Čtení a zápis stavu do `localStorage`.
- **`src/lib/sync.ts`**: Rozklad stavu aplikace na jednotlivé záznamy a výpočet diffů (`diffStates`).
- **`src/lib/sync-engine.ts`**: Řízení synchronizace, fronta neodeslaných změn (`outbox`), metody `pull` a `push`.
- **`src/lib/sync-runtime.ts`**: Síťové napojení na Supabase, automatické spouštěče (debounce 2s, focus, interval 2 min).
- **`src/lib/account-merge.ts`**: Algoritmy pro převzetí dat ze zařízení a slévání při přihlášení.

---

## 3. Testovací sada

Funkčnost offline ukládání a řešení kolizí je ověřena automatickými testy:
- `src/lib/sync.test.ts`
- `src/lib/sync-engine.test.ts`
- `src/lib/account-merge.test.ts`

Spuštění testů: `npm run test`
