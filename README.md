# Portfolio-tracker

`ReportReader.html` je samostatná stránka pro prohlížení **Flex Query XML reportů z Interactive Brokers**: přehled, pozice, obchody, P&L, deriváty, dividendy, úroky, poplatky a vklady s přepočtem do CZK, grafy a export do Excelu / PDF. Vše běží lokálně v prohlížeči — stačí soubor otevřít a přetáhnout do něj XML.

## Více účtů v jednom reportu

Flex Query může obsahovat víc účtů (každý jako vlastní `FlexStatement`). Stránka je sloučí do jednoho portfolia: denní hodnoty, Change in NAV, Cash Report, výkonnost, obchody, dividendy i uzavřené loty se sčítají; stejný cenný papír na obou účtech je jeden řádek pozic a % NAV se počítá z celku. IB TWR existuje jen pro jeden účet, proto se u sloučených účtů počítá z denních hodnot. Pro daně se účty sčítají (limit 100 000 Kč je za poplatníka).

Stránka toleruje i dotaz bez některých polí: chybí-li *Level of Detail*, bere všechny řádky; chybí-li *Type* u Cash Transactions, pozná dividendy, srážkovou daň, poplatky, vklady a úroky podle popisu (a upozorní na to); chybí-li kurz pro CZK, použije kurz zadaný při nahrání (a upozorní). Převody pozic (ACATS, mezi účty) ze sekce *Transfers* počítá jako vklady/výběry; skok hodnoty bez vkladu stránka označí upozorněním, protože zkresluje TWR.

## Ukládání dat

Nahrané reporty se ukládají, takže je nemusíte nahrávat pokaždé znovu. Stránka při otevření sama otevře naposledy použitý report i s vaším kurzem; ostatní uložené reporty jsou na úvodní obrazovce (tlačítko **Uložené reporty** v hlavičce).

- **V prohlížeči** (vždy): IndexedDB. Report se ukládá jako původní XML, komprimovaný (gzip), a při otevření se znovu zpracuje. Spolu s ním kurz, ruční příjmy (výplata, nájem), kurzy ČNB a nastavení daní.
- **V účtu Claude** (jen ve zveřejněné stránce po přihlášení): totéž se zrcadlí do soukromé části databáze artefaktu `data/users/<vaše id>/…`, kterou nevidí nikdo jiný ani majitel stránky. Díky tomu jsou data na každém zařízení. Velké reporty se dělí na kousky (limit dokumentu je 256 KiB). Synchronizaci jde vypnout; při souběžných změnách na dvou zařízeních vyhrává novější zápis.
- Pokud je stránka sdílená jen pro čtení, do účtu zapisovat nelze a funguje jen ukládání v prohlížeči.
- Ukázková data se nikdy neukládají. Ukládání reportů lze vypnout na úvodní obrazovce.

## Příjmy po měsících

Záložka **Příjmy** ukazuje dividendy, prodeje akcií a opce po měsících, s výběrem měsíce. K tomu si do tabulky můžete ručně zadat **výplatu** a **příjem z nájmu** (v Kč) za každý měsíc reportu — součet za měsíc i za celé období pak ukazuje celkový příjem (investice + výplata + nájem). Ručně zadané částky se ukládají jen v prohlížeči (localStorage), nikam se neodesílají a platí pro daný kalendářní měsíc i v dalších reportech. Jsou i v Excel exportu.

## Daně

Záložka **Daně** připraví podklady pro daňové přiznání fyzické osoby za vybraný rok:

- **Přepočet do Kč** jednotným kurzem GFŘ (předvyplněno 2022–2025 pro EUR a USD, ostatní roky a měny se doplní ručně) nebo denními kurzy ČNB (roční soubor `rok.txt` z cnb.cz se nahraje do stránky). Výdaje se přepočítávají kurzem dne / roku, kdy vznikly.
- **Prodeje cenných papírů (§ 10)** po jednotlivých lotech: časový test 3 roky, limit 100 000 Kč (s volbou, zda do něj počítat prodeje po časovém testu), zdanitelné příjmy a výdaje.
- **Opce a deriváty (§ 10)**: příjmy a výdaje uzavřených pozic, u prodaných opcí je přijatá prémie příjmem.
- **Dividendy (§ 8)** podle státu zdroje (z ISIN) se sraženou daní — podklad pro přílohu č. 3.

Pro časový test potřebuje Flex Query v sekci *Trades* volbu **Closed Lots** (datum nákupu každé prodané části). Bez ní stránka páruje nákupy a prodeje jen v rámci reportu a upozorní na prodeje s neznámým nákupem. Jde o orientační výpočet, ne daňové poradenství.

## Ukázková data

Na úvodní obrazovce je tlačítko **Vyzkoušet na ukázkových datech**: načte smyšlený účet za leden–červen 2026 (akcie v USD i EUR, dividendy se srážkovou daní, prodeje akcií, opce otevřené i uzavřené, vklad a výběr, úroky a poplatky). Tlačítko **Stáhnout ukázkový XML** uloží stejná data jako soubor, aby šlo vyzkoušet i nahrání souboru.

Stejný soubor je v [`samples/ukazkovy-flex-report.xml`](samples/ukazkovy-flex-report.xml). Data generuje skript `<script id="sample-data">` přímo ve stránce; po jeho změně soubor obnovíte příkazem `npm run sample`.

## Testy

Testy načtou stránku v Chromiu (Playwright) se syntetickým Flex XML (`tests/fixture.js`) a ověří výpočty: TWR, benchmark, přepočet měn, deriváty včetně Excel exportu, řazení a DPH u poplatků.

```bash
npm install
npx playwright install chromium   # jen poprvé, pokud prohlížeč ještě nemáte
npm test
```

Externí požadavky (CDN, Yahoo, stooq) jsou v testech zablokované; SheetJS se podstrčí z `node_modules`.
