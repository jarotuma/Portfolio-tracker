# Portfolio-tracker

`ReportReader.html` je samostatná stránka pro prohlížení **Flex Query XML reportů z Interactive Brokers**: přehled, pozice, obchody, P&L, deriváty, dividendy, úroky, poplatky a vklady s přepočtem do CZK, grafy a export do Excelu / PDF. Vše běží lokálně v prohlížeči — stačí soubor otevřít a přetáhnout do něj XML.

## Testy

Testy načtou stránku v Chromiu (Playwright) se syntetickým Flex XML (`tests/fixture.js`) a ověří výpočty: TWR, benchmark, přepočet měn, deriváty včetně Excel exportu, řazení a DPH u poplatků.

```bash
npm install
npx playwright install chromium   # jen poprvé, pokud prohlížeč ještě nemáte
npm test
```

Externí požadavky (CDN, Yahoo, stooq) jsou v testech zablokované; SheetJS se podstrčí z `node_modules`.
