# MicroWins jako Android appka

Appka běží v telefonu offline ze souborů v APK. Není to zástupce na web —
nativní obal (Capacitor) drží WebView, splash screen, ikonu, stavovou lištu,
hardwarové tlačítko Zpět, vibrace a napojení na kalendář telefonu.

Návod pro uživatele (instalace, účet, propojení s Google kalendářem, co dělat,
když něco nejde) je v [`docs/navod-synchronizace.md`](docs/navod-synchronizace.md).
Tenhle soubor je pro toho, kdo appku staví a vydává.

## Co je kde

| Cesta | Co to je |
|---|---|
| `capacitor.config.ts` | ID appky, jméno, barvy, chování splash screenu a lišt |
| `android/` | nativní projekt (Gradle). Generuje ho Capacitor, ruční úpravy přežijí |
| `android/app/src/main/AndroidManifest.xml` | oprávnění (internet, kalendář), appka jen na výšku |
| `android/app/src/main/java/cz/microwins/app/` | `MainActivity`, `CalendarSyncPlugin` (synchronizace kalendáře, události zrcadla, barva hotového), `CalendarSyncWorker` (synchronizace na pozadí) |
| `android/app/src/main/res/` | ikony, splash, barvy a témata |
| `scripts/android-assets.mjs` | generátor ikon, splashe a loga v appce z `assets/logo_mark.png` |
| `src/lib/native.ts` | most do nativní vrstvy (haptika, lišta, splash, tlačítko Zpět) |
| `src/lib/calendar.ts` | propojení time boxu s Google kalendářem (čtení i zrcadlo oběma směry) |
| `src/lib/live-update.ts` | živé aktualizace (OTA) |
| `out/` | statický export webu, který se do APK kopíruje |

## Nástroje na tomhle počítači

Nic z toho není nainstalované v systému — leží to vedle sebe v `C:\Android`
a build si na to sáhne sám.

- Android SDK: `C:\Android\sdk` (platform 35 a 36, build-tools 35 a 36),
  ADB: `C:\Android\sdk\platform-tools\adb.exe`
  - cesta je zapsaná v `android/local.properties` **lomítky dopředu** —
    `sdk.dir=C:\Android\sdk` se v Java properties přečte jako `C:Androidsdk`.
    Soubor je mimo git, v čerstvém klonu ho dopiš.
- JDK 21: `C:\Android\jdk\jdk-21.0.12+8`
  - Capacitor 8 se kompiluje na Javu 21, v systému je 17;
    build si vlastní JDK bere přes `org.gradle.java.home` v `android/gradle.properties`
- `gh` (GitHub CLI) na počítači **není** — release se dělá přes API, viz níž.

## Sestavení APK

```bash
npm run android:apk
```

Postaví OTA balík i APK z jednoho buildu (stejná verze), výsledek je
`android/app/build/outputs/apk/debug/app-debug.apk`. Tohle APK se i vydává —
je podepsané debug klíčem tohohle počítače, stejně jako všechna APK, která
kdy do telefonů šla (viz *Podpisový klíč*), takže jde instalovat přes ně.

`npm run android:release` (release podpis) potřebuje `android/microwins.jks`,
který na tomhle počítači není. Přechod na release klíč by znamenal pro
každého odinstalaci a novou instalaci — data v účtu přežijí, nastavení
uložená jen v telefonu ne.

Build na Windows někdy zamrzne na přejmenování složky v mezipaměti Gradlu
(antivirus). Když se log přes pár minut nehne, zabij Gradle a pusť build znovu.

## Instalace do telefonu

Přes kabel, když je v telefonu zapnuté ladění USB:

```bash
C:\Android\sdk\platform-tools\adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Bez kabelu: stáhnout z [GitHub → Releases](https://github.com/MonsterMarian/MicroWins/releases/latest)
nebo APK zkopírovat do telefonu a otevřít ho tam. Android se zeptá na povolení
instalovat z tohoto zdroje — jednorázově potvrď.

## Živé aktualizace (bez přeinstalace)

Appka je hromada statických souborů, které Capacitor servíruje z telefonu.
Když se ty soubory vymění, po restartu běží nová verze — **bez instalace APK**.

Co takhle projde: všechno v `src/` — funkce, opravy, texty, vzhled.
Co neprojde: nativní část (nový plugin, oprávnění, ikona, `targetSdk`, zámek
na výšku). Tam je potřeba nové APK.

Adresa je zadrátovaná v `src/lib/live-update.ts` jako `DEFAULT_UPDATE_URL`,
takže se nikde nic nenastavuje — appka se aktualizuje sama.

### Vydání nové verze (OTA)

```bash
npm run ota:bundle
```

Vyrobí `ota/bundle-<verze>.json` (celá appka v jednom souboru) a
`ota/latest.json` (manifest). Pak stačí commit a push — appka si při startu
stáhne manifest, a když je **novější** než to, co běží, stáhne balík a nasadí
ho **při dalším otevření**. Starší balík (třeba manifest, který se ještě
nepushnul po novém APK) se ignoruje — nové APK tak nikdy nespadne o verzi
zpátky.

Na `main` pushuje i někdo jiný. Pořadí proto je: `git fetch` → `git rebase
origin/main` → `npx tsc --noEmit` a `npx vitest run` → `npm run ota:bundle` →
commit → push. Balík postavený před rebase by v sobě cizí změny neměl.

Nasazuje se schválně až při dalším startu: přepnutí za běhu by uživateli zmizela
obrazovka pod rukama.

**Číslo verze musí sedět mezi webem a manifestem.** `scripts/release.mjs` proto
staví web sám a předává mu verzi přes `NEXT_PUBLIC_BUNDLE_VERSION` — kdyby se
stavělo zvlášť, appka by po každé instalaci stahovala balík, který už v sobě má.
Skript to na konci kontroluje a při nesouladu skončí chybou.

### Nové APK a GitHub release

Nutné jen při zásahu do nativní části. Postup:

1. `npm run android:apk`, otestovat v telefonu.
2. Commit a push **i s `ota/`** — jinak by si telefon s novým APK stáhl
   starší balík z GitHubu (dnes ho sice ignoruje, ale ostatní zařízení by
   novou verzi webu nedostala).
3. Release: tag `v<versionName>` (`aapt dump badging` na APK, versionName je
   časové razítko buildu), cíl = pushnutý commit, asset
   `MicroWins-<versionName>.apk`, „latest“. Bez `gh` přes REST API
   (`POST /repos/MonsterMarian/MicroWins/releases` a upload na
   `uploads.github.com`), token z `git credential fill` (tentýž, co používá
   `git push`) — **nikdy ho nevypisovat**.

Appka sama v Nastavení → Kalendář odkazuje na `/releases/latest`, když jí
chybí nativní pluginy (starší APK s novým webem z OTA).

`MicroWins.apk` v kořeni repa je stará kopie z 27. 8. 2026 — nové verze
patří do Releases.

### Když se něco pokazí

Rozbalovací **Nastavení → Aktualizace → Adresa manifestu** dovolí ukázat appku
jinam, než kam míří výchozí adresa. Balík, který appku položí, řeší hlídač
startu v `app/layout.tsx`: když se do pár vteřin nikdo neozve, vrátí se sám
k verzi z APK.

### Data při aktualizaci

Zůstávají. Data žijí v účtu, v telefonu je jejich kopie v `localStorage`, který
patří k adrese `localhost` — výměna souborů ani přeinstalace APK přes
existující appku ho nemění. Odinstalace smaže jen to, co je uložené výhradně
v telefonu (viz *Data*).

## Změna ikony nebo splashe

Zdroj je jediný soubor: `assets/logo_mark.png` — značka na **průhledném**
pozadí. Po jeho výměně stačí:

```bash
npm run android:assets
```

Vygeneruje se z něj celá sada: ikony pro launcher (včetně adaptivní
a monochromatické vrstvy pro tématické ikony na Androidu 13+), splash ve všech
hustotách a logo pro hlavičku appky (`src/lib/logo-image.ts` — generovaný
soubor, needitovat ručně).

Barvy pozadí jsou dvě konstanty na začátku skriptu:

| Konstanta | Kde se projeví | Proč zrovna tahle |
| --- | --- | --- |
| `BRAND_NAVY` | pozadí ikony v launcheru | trofej je na tuhle modrou nakreslená |
| `APP_BACKGROUND` | splash | musí sedět s `--background` v `globals.css` a s `capacitor.config.ts`, jinak mezi splashem a appkou blikne |

**Značka musí být průhledná.** Když se do `logo_mark.png` dá obrázek
s vlastním pozadím, launcher pod něj podloží ještě `BRAND_NAVY` a v ikoně je
vidět čtvereček na jinak barevném podkladu — dvě pozadí přes sebe. Vygenerované
předlohy tohle mívají zapečené v pixelech; ořízne je:

```bash
python scripts/extract-logo-mark.py assets/logo_source.jpeg
```

## Podpisový klíč

Všechna APK, co kdy šla do telefonů (i `MicroWins.apk` v repu a Releases), jsou
podepsaná **debug klíčem tohohle počítače**:
`%USERPROFILE%\.android\debug.keystore`, certifikát SHA-256
`601fcceb534dac4be2a33db215cb2eb8ef1a8efa78b544d8efdda717864c719b`.

**Ten soubor zálohuj.** Android považuje appku podepsanou jiným klíčem za jinou
appku — bez něj nejde vydat aktualizaci, jen odinstalovat a nainstalovat
znovu. Data v účtu to přežijí, nastavení uložená jen v telefonu ne.

Release klíč (`android/microwins.jks` + `android/keystore.properties`, obojí
mimo git) na tomhle počítači není. Založit by šel takhle — ale viz výš, přechod
znamená přeinstalaci u všech:

```bash
C:\Android\jdk\jdk-21.0.12+8\bin\keytool.exe -genkeypair -v -keystore android/microwins.jks -alias microwins -keyalg RSA -keysize 2048 -validity 10000
```

## Když se APK nedá nainstalovat

1. **„Aplikace nebyla nainstalována“ při aktualizaci** — v telefonu je verze
   podepsaná jiným klíčem. Odinstaluj ji a nainstaluj znovu (data v účtu
   zůstanou, po přihlášení se vrátí).
2. **Play Protect** — hlásí „Neznámá aplikace zablokována". Klepni na
   *Další podrobnosti → Přesto nainstalovat*.
3. **Povolení instalace** — telefon chce povolit instalaci konkrétní appce,
   ze které APK otevíráš (Soubory, Chrome). Nastavení nabídne samo.
4. **Android starší než 7.0** — appka nepojede, `minSdk` je 24 a níž ho
   Capacitor 8 nepustí.
5. **Poškozený přenos** — messengery APK překomprimují. Posílej kabelem
   nebo přes Disk, nejlíp rovnou odkaz na Releases.

## Data

Od 14. 10. 2026 je přihlášení povinné a **zdroj pravdy je účet** (Supabase,
tabulka `records`) — viz [`DATABAZE.md`](DATABAZE.md) a
[`IMPLEMENTACE_SYNCHRONIZACE.md`](IMPLEMENTACE_SYNCHRONIZACE.md). V telefonu je
v `localStorage` kopie pro práci offline; změny se odešlou, až bude síť.
Zálohy do souboru (Exportovat / Obnovit ze souboru) byly zrušené — data
přežijí výměnu i ztrátu telefonu v účtu.

Jen v telefonu (do účtu se neposílá, odinstalace to smaže):

| Klíč v `localStorage` | Co |
|---|---|
| `microwins:calendar` | propojení s kalendářem: čtení, cílový kalendář |
| `microwins:calendar-base`, `microwins:calendar-conflicts` | stav zrcadla kalendáře a nevyřešené konflikty |
| `microwins:ai-key:*` | klíč k AI pro návrhy z brain dumpu |
| `microwins:ota:*` | stav živých aktualizací |
| `microwins:device` | id zařízení (podle něj se pozná, který telefon zrcadlí kalendář) |

**Testovat se nesmí na skutečném účtu tak, aby se data v DB smazala nebo
přepsala** — obrazovky za přihlášením se ověřují s falešnou session, logika
synchronizace proti serveru v paměti (`sync-engine.test.ts`).

### Data z jiné aplikace

`scripts/import-progress.mjs` převede CSV export z aplikace Progress na data
MicroWins. Obnova ze souboru v appce už není, takže do telefonu se dostanou
jen cestou *Doručení dat balíkem* níž — po usazení se samy nahrají do účtu.

```bash
node scripts/import-progress.mjs --in <složka s CSV> [--out <soubor.json>]
```

Skript si na konci sám přepočítá procenta podle pravidel MicroWins a porovná je
se zdrojem — když se rozejdou, mapování je špatně a skript skončí chybou.
Komentáře se dopíšou do popisu úkolu (appka je nemá), přílohy se nepřenesou.

#### Doručení dat balíkem (bez souboru)

Data se do telefonu dají dostat i bez kopírování souboru: balík si je přiveze
s sebou, při prvním spuštění se usadí do `localStorage` a odtud do účtu.

1. `node scripts/import-progress.mjs --seed src/lib/seed-import-data.ts`
2. Přidat `src/lib/seed-import.ts` — jednorázové použití (značka
   `microwins:seed:<id>` v localStorage), rozsah **jen projekty**, plus
   pojistka „projekt se stejným názvem a startem už tu je".
3. Zavolat `applySeed(loaded)` v `store-provider.tsx` při hydrataci.
4. `npm run ota:bundle`, commit, push. Uživatel nasadí, data se usadí.
5. **Po potvrzení** smazat oba soubory i volání, vydat čistý balík.

Pátý krok neodkládej — dokud je seed v manifestu, stáhne si ho každý, kdo
appku s touhle adresou spustí. A pozor: data zůstávají v historii gitu i po
smazání souboru, takže tímhle neposílej nic, co nemá být veřejné.

**Historie postupu** se skládá zpátky z dat vzniku a poslední změny každého
úkolu a podúkolu: zaškrtnutí je skok v den odškrtnutí (přesné), u číselných
úkolů se růst mezi vznikem a poslední změnou odhaduje rovnoměrně. Bez toho by
graf i deník změn byly u každého projektu jedna přímka. Poslední otisk padne
nejpozději na včerejšek — s otiskem k dnešku by appka celý přenesený postup
ohlásila jako přírůstek dne importu.

## Google kalendář

Jak to funguje pro uživatele, je v [`docs/navod-synchronizace.md`](docs/navod-synchronizace.md);
proč takhle a jak to drží pohromadě, v komentářích `src/lib/calendar.ts`.
Pro build a ladění podstatné:

- Jde přes **kalendář v telefonu** (Android CalendarContract), ne přes Google
  API — žádný OAuth, server ani tajný klíč. Pluginy: `@ebarooni/capacitor-calendar`
  (čtení, zápis) a vlastní `CalendarSyncPlugin` (ruční synchronizace — s
  vypnutou automatickou synchronizací účtů by Android nic neodeslal —,
  události zrcadla, barva hotového = Grafitová, hlídání změn) a
  `CalendarSyncWorker` (WorkManager, co 15 minut na pozadí).
- Oprávnění `READ_CALENDAR`/`WRITE_CALENDAR` se appka ptá až v Nastavení.
- Události zrcadla nesou v popisu značku `microwins:<id>`. Ověřování přes ADB:

  ```bash
  adb shell "content query --uri content://com.android.calendar/events --projection _id:title:dirty:_sync_id:eventColor_index --where \"description LIKE '%microwins:%'\""
  ```

  `dirty=0` a vyplněné `_sync_id` = odesláno do Googlu.
- Pozor: `adb shell requestsync` **bez argumentů nevypíše nápovědu, ale spustí
  synchronizaci všech účtů** (nápověda je `-h`).
- Testuje se na kalendáři MicroWins (v telefonu `_id=14`) a testovací bloky a
  ToDo se potom mažou přes UI appky.

## Pozor při vývoji

- Routy nesmí být dynamické (`/projects/[id]`). Statický export neumí
  předgenerovat cesty pro id, která vzniknou až v telefonu — proto
  `/projects?id=…`, `/projects/stats?id=…` a `/tasks?id=…`.
- Každá změna webu se do appky dostane až přes `cap sync android`.
  Samotný `next build` na APK nesáhne.
- `npm run build` (i `ota:bundle`) za běhu dev serveru rozbije dev appku
  v prohlížeči — server napřed zastav.
- Appka je jen na výšku (`screenOrientation="portrait"` v manifestu).
