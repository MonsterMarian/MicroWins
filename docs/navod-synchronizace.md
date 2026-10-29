# MicroWins: instalace, účet a synchronizace

Krátký návod pro každého, kdo má MicroWins v telefonu jako APK. Nic z toho
není potřeba umět - stačí projít kroky odshora.

## 1. Instalace a aktualizace

**První instalace**

1. Stáhni nejnovější `MicroWins-….apk` z
   [GitHub → Releases](https://github.com/MonsterMarian/MicroWins/releases/latest).
2. Otevři ho v telefonu. Android se zeptá, jestli smí instalovat z tohoto
   zdroje (Chrome, Soubory…) - jednou povol.
3. Hlásí-li Play Protect „Neznámá aplikace“, klepni na *Další podrobnosti →
   Přesto nainstalovat*.

**Aktualizace** jsou dvojí:

| Co | Jak přijde | Co musíš udělat |
|---|---|---|
| Běžné opravy a novinky (vzhled, funkce) | samy, appka si je stáhne při startu | nic - po dalším otevření appky běží nová verze |
| Nativní změny (nový plugin, oprávnění) | jen novým APK z Releases | stáhnout a nainstalovat přes starou verzi - **data zůstanou** |

Když appka něco potřebuje z nového APK (třeba propojení s kalendářem), sama to
v Nastavení řekne a dá odkaz ke stažení.

> APK instaluj vždycky **přes** tu starou, neodinstalovávej. Odinstalace smaže
> nastavení uložená jen v telefonu (data v účtu zůstanou).

## 2. Účet a data mezi zařízeními

- Appka chce účet: **Přihlásit se**, nebo **Nový účet** (e-mail + heslo).
- Všechno, co do appky napíšeš, se ukládá do účtu. Na jiném telefonu se po
  přihlášení objeví totéž.
- Funguje i **bez internetu** - změny se odešlou, až bude síť.
- Píšeš-li tutéž věc na dvou zařízeních zároveň, vyhraje ta **novější** změna.
- Odhlásit tě appka sama nikdy nebude (jen tlačítko *Odhlásit* v Nastavení →
  Hlavní). Když server přihlášení zruší, v Nastavení se objeví *Přihlásit*.

## 3. Propojení s Google kalendářem

Time box (bloky v mřížce) a ToDo s termínem se dají zrcadlit do Google
kalendáře - **oběma směry**. Co uděláš v appce, uvidíš v Googlu, a co
uděláš v Googlu, propíše se do appky.

### Nastavení (jednou, 2 minuty)

1. Na počítači otevři [calendar.google.com](https://calendar.google.com) →
   vlevo *Další kalendáře* **+** → *Vytvořit nový kalendář*. Název `MicroWins`,
   **Vytvořit kalendář**. (Vlastní kalendář je lepší než ten hlavní: dá se
   jedním klepnutím skrýt nebo celý smazat a nemíchá se se schůzkami.)
2. V telefonu otevři aplikaci **Google Kalendář**, stáhni seznam prstem dolů
   (obnovit) a v menu zkontroluj, že je `MicroWins` zaškrtnutý.
3. V MicroWins: **Nastavení (ozubené kolo) → Addony → Kalendář → Propojit
   s kalendářem v telefonu** → v okně Androidu **Povolit**.
4. Zapni **Ukazovat schůzky v time boxu**, chceš-li v mřížce vidět své
   schůzky.
5. V **Bloky a ToDo propojit s** vyber `MicroWins`. Hotovo.

### Co se kam dostane

| V appce | V Google kalendáři |
|---|---|
| blok v time boxu (od včerejška dál) | událost ve stejný čas |
| ToDo s termínem a hodinou | půlhodinová událost v čase termínu |
| ToDo s termínem bez hodiny | celodenní událost |
| ToDo naplánované do mřížky | jen ten blok (ne dvakrát) |
| odškrtnutý blok | událost s `✓` na začátku názvu |
| odškrtnuté / smazané ToDo | událost zmizí |

Starší dny zůstávají v kalendáři jako historie.

### Co jde dělat v Googlu

| Uděláš v Googlu | Stane se v appce |
|---|---|
| přejmenuješ událost | přejmenuje se blok (nebo ToDo, hlavní věc dne, úkol projektu - podle toho, odkud blok je) |
| posuneš / prodloužíš | blok se posune na přesný čas, ToDo dostane nový termín |
| přetáhneš ToDo na celý den | ToDo ztratí hodinu (termín bez hodiny) |
| dáš `✓` na začátek názvu (jde i ✔ nebo ✅) | blok/ToDo se odškrtne |
| smažeš blok | blok se smaže - appka nabídne **Vrátit** |
| smažeš ToDo | ToDo se odškrtne - appka nabídne **Vrátit** |

Google kalendář u událostí zaškrtávátko nemá, proto `✓` v názvu.

Celodenní nebo opakovaná událost čas bloku nést neumí - když na ni blok
v Googlu převedeš, appka ho vrátí zpátky na čas.

### Kdy se co propíše

- **Z appky do Googlu:** za pár sekund po změně (je-li síť).
- **Z Googlu do appky:** když je appka otevřená, každé 3 minuty a při každém
  návratu do appky. Když je zavřená, telefon si kalendář stahuje sám co
  15 minut a appka změny převezme hned po otevření.

Tohle funguje i s vypnutou *Automatickou synchronizací* účtů v Androidu -
appka si o synchronizaci kalendáře řekne sama.

### Konflikty

Změníš-li **tutéž věc** v appce i v Googlu dřív, než se stihly potkat:

- **různé věci** (v appce posuneš, v Googlu přejmenuješ) - platí obojí, nic
  se neřeší;
- **stejnou věc jinak** (v appce na 9:00, v Googlu na 10:00) - zůstane verze
  z appky a vyskočí hláška s **Vzít z Googlu**. Když ji přehlédneš, počká
  v **Nastavení → Addony → Kalendář** v seznamu *Změněno v appce i v Googlu*:
  vyber **Vzít z Googlu**, nebo **Nechat**;
- **v Googlu smazané, v appce mezitím změněné** - zůstane (úprava je novější)
  a appka nabídne **Smazat**.

### Jeden telefon

Zrcadlo běží jen na **jednom** telefonu - dva by si kalendář přetahovaly. Když
ho zapneš na druhém, první přestane a v Nastavení ukáže *Propojení teď běží na
jiném telefonu* s tlačítkem **Převzít sem**. Schůzky v mřížce (čtení) můžou
ukazovat všechny telefony.

### Pojistky

- Zmizí-li z Googlu **skoro všechno naráz** (odpojený nebo smazaný kalendář),
  appka nic nemaže a události založí znovu.
- Přestane-li telefon kalendář synchronizovat, appka zrcadlo nechá být, dokud
  se to nespraví.
- Při prvním propojení appka z kalendáře nic nepřebírá - jen do něj zapíše
  své bloky.

## 4. Když něco nejde

| Problém | Řešení |
|---|---|
| V Nastavení chybí sekce *Kalendář* | Zapni addon Time box (Nastavení → Addony). Ukazuje-li sekce *Stáhnout nové APK*, nainstaluj ho. |
| *Bez přístupu ke kalendáři* | Android → Nastavení → Aplikace → MicroWins → Oprávnění → Kalendář → Povolit. |
| V nabídce chybí kalendář `MicroWins` | V aplikaci Google Kalendář obnov (stáhnout dolů) a zaškrtni ho v menu; pak Nastavení v MicroWins zavři a otevři znovu. |
| Změna z Googlu se neobjevila | Otevři MicroWins (nebo z ní odejdi a vrať se) - stáhne novinky. Bez internetu počká. |
| Blok zmizel | Byl smazaný v Googlu - hned po tom šlo dát **Vrátit**. Jinak ho napiš znovu. |
| V Googlu je něco dvakrát | Appka duplikáty sama maže při dalším běhu (otevření appky). Pomůže i odejít a vrátit se. |
| Chci propojení vypnout | **Bloky a ToDo propojit s → nepropojovat**. Zrcadlo z kalendáře zmizí (jen od včerejška dál, historie zůstane). |
| Schůzky v mřížce nechci | Vypni **Ukazovat schůzky v time boxu**. |
| Vidím schůzky z účtu, který nechci | V aplikaci Google Kalendář ho v menu odškrtni - MicroWins bere jen zaškrtnuté kalendáře. |

## 5. Co appka nedělá

- Neposílá nic Googlu sama - všechno jde přes kalendář v telefonu. Žádné
  přihlášení do Googlu v appce, žádný server navíc.
- Nezapisuje do kalendáře schůzky - jen svoje bloky a ToDo. Cizí události
  nikdy nemění ani nemaže.
- Úkoly v Google Tasks neumí (mají zaškrtávátko, ale telefon k nim appce
  přístup nedává).
