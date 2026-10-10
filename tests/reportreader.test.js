// Browser tests for ReportReader.html on a synthetic IB Flex Query XML.
// Usage: npm test   (or: node tests/reportreader.test.js [path/to/ReportReader.html])
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSXN = require('xlsx');
const fixture = require('./fixture');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'ReportReader.html'));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'reportreader-'));
const XLSX_JS = require.resolve('xlsx/dist/xlsx.full.min.js');
let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → got ' + JSON.stringify(got)}`); if (!ok) fails++; };
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

async function open(browser, opts, rate = '23') {
  const xmlPath = path.join(OUT, `fx_${opts.vat || 'calc'}_${opts.spyFull ? 'full' : 'part'}_${opts.base || 'USD'}.xml`);
  fs.writeFileSync(xmlPath, fixture(opts));
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    if (u.includes('xlsx.full.min.js')) return route.fulfill({ path: XLSX_JS, contentType: 'application/javascript' });
    return route.abort();
  });
  await page.goto('file://' + PAGE);
  await page.setInputFiles('#file-input', xmlPath);
  await page.waitForSelector('#rate-modal', { state: 'visible' });
  const title = await page.textContent('#rate-title');
  await page.fill('#rate-input', rate);
  await page.click('#rate-modal button');
  await page.waitForSelector('#app.visible');
  return { page, errors, title };
}

(async () => {
  const browser = await chromium.launch();

  // ── Main scenario: USD base, EUR positions, 21 % VAT estimate, partial SPY ──
  {
    const { page, errors, title } = await open(browser, { vat: 'calc' });
    check('rate dialog shows base currency', title === 'Kurz USD / CZK', title);

    // (3) multi-currency: market value in base
    const mv = await page.evaluate(() => G.data.positions.reduce((s,p) => s + parseFloat(p.mktVal||0), 0));
    check('3: total market value converted to base (4536)', near(mv, 4536), mv);
    const div = await page.evaluate(() => G.data.cashTxns.find(c => c.type === 'Dividends').amount);
    check('3: EUR dividend converted (11)', near(div, 11), div);
    const comm = await page.evaluate(() => G.data.trades.find(t => t.symbol === 'SAP').comm);
    check('3: EUR commission converted (-1.1)', near(comm, -1.1), comm);
    const sapStart = await page.evaluate(() => G.data.pnl.find(p => p.symbol === 'SAP').startVal);
    check('3: MTM start value converted (1210)', near(sapStart, 1210), sapStart);

    // (1) TWR
    const expTWR = (1.02 * (10150/10100) * (15000/15150) * (15300/15000) * (15453/15300) - 1) * 100;
    const twr = await page.evaluate(() => document.getElementById('chart-canvas')._chartMeta.allSeries[0].vals.at(-1));
    check(`1: chart TWR chained with flows (${expTWR.toFixed(4)})`, near(twr, expTWR, 1e-6), twr);
    const day2 = await page.evaluate(() => document.getElementById('chart-canvas')._chartMeta.allSeries[0].vals[2]);
    check('1: deposit day has no jump (+2.4950 %)', near(day2, (1.02 * 10150/10100 - 1) * 100, 1e-6), day2);
    await page.click('#btn-stocks');
    const stocksEnd = await page.evaluate(() => document.getElementById('chart-canvas')._chartMeta.allSeries.find(s => s.key==='stocks').vals.at(-1));
    check('1: stocks series is plain value change, not forced to portfolio TWR', near(stocksEnd, (15453/10000 - 1) * 100), stocksEnd);
    const cardSub = await page.textContent('#cards-czk');
    check('1: TWR card shows value computed from daily data', cardSub.includes('z denních hodnot'), cardSub);

    // (2) benchmark: partial SPY in XML must NOT be used
    await page.click('#btn-spx');
    await page.waitForFunction(() => !CHART.bmLoading.spx, null, { timeout: 90000 });
    const usedXml = await page.evaluate(() => CHART.bmData.spx);
    check('2: partial SPY from XML not used as benchmark', usedXml == null, usedXml);
    // CSV benchmark starting before the period → rebased to 0 % on day 0
    const bm = await page.evaluate(() => {
      CHART.bmData.spx = parseCSV('Date,Close\n2025-12-31,100\n2026-01-02,110\n2026-01-06,115.5\n2026-01-09,121');
      CHART.bm.spx = true; drawChart();
      return document.getElementById('chart-canvas')._chartMeta.allSeries.find(s => s.key==='spx').vals;
    });
    check('2: CSV benchmark rebased to 0 % on first day', near(bm[0], 0, 1e-9), bm);
    check('2: CSV benchmark carries last close forward (05.01 = 0 %, 06.01 = +5 %)', near(bm[1], 0, 1e-9) && near(bm[2], 5, 1e-9), bm);
    check('2: CSV benchmark last = +10 %', near(bm.at(-1), 10, 1e-9), bm);

    // (5) derivatives — manual price for XYZ conid 1003 only
    await page.click('.tab:has-text("Deriváty")');
    await page.fill('input[data-under-key="underPrice_1003"]', '55');   // no blur
    await page.click('button:has-text("Zpracuj deriváty")');
    const recap = async () => page.$$eval('#der-output table', ts => {
      const t = ts.at(-1); return [...t.querySelectorAll('tfoot tr')].map(r => r.textContent.replace(/\s+/g,' ').trim());
    });
    const r23 = await recap();
    check('5: recap receivables 56 900 USD (fallback price + EUR fx)', r23[0].replace(/\s/g,'').includes('56900'), r23);
    check('5: recap liabilities 52 500 USD', r23[1].replace(/\s/g,'').includes('52500'), r23);

    // (4) changing the rate refreshes the derivatives output
    await page.click('#hdr-rate');
    await page.fill('#rate-input', '25');
    await page.click('#rate-modal button');
    const r25 = await recap();
    check('4: derivatives CZK recomputed after rate change (56 900 × 25 = 1 422 500)', r25[0].replace(/\s/g,'').includes('1422500'), r25);

    // (5) Excel uses the same underlying prices as the screen
    const dl = page.waitForEvent('download');
    await page.click('button:has-text("Excel export")');
    const file = path.join(OUT, 'export.xlsx');
    await (await dl).saveAs(file);
    const wb = XLSXN.readFile(file);
    const der = XLSXN.utils.sheet_to_json(wb.Sheets['Deriváty'], { header: 1 });
    const pohRow = der.find(r => r[0] === 'Pohledávky celkem');
    const zavRow = der.find(r => r[0] === 'Závazky celkem');
    check('5: Excel receivables = screen (56 900)', near(pohRow[1], 56900), pohRow);
    check('5: Excel liabilities = screen (52 500)', near(zavRow[3], 52500), zavRow);

    // (7) VAT estimate mode
    const of = XLSXN.utils.sheet_to_json(wb.Sheets['Poplatky'], { header: 1 });
    const vatSum = of.slice(1).filter(r => typeof r[5] === 'number').reduce((s,r) => s + r[5], 0);
    check('7: calc mode — 21 % of fees (-3.045)', near(vatSum, -3.045, 0.011), vatSum);

    // (6) sorting by date
    await page.click('.tab:has-text("Obchody")');
    await page.click('#tbl-trades th:has-text("Datum")');
    const dates = await page.$$eval('#tbl-trades tbody tr td:first-child', tds => tds.map(t => t.textContent.trim()));
    check('6: trades sorted by full date ascending', JSON.stringify(dates) === JSON.stringify(['31.12.2025','05.01.2026','08.01.2026','09.01.2026']), dates);
    await page.click('#tbl-trades th:has-text("Cena")');
    const prices = await page.$$eval('#tbl-trades tbody tr td:nth-child(6)', tds => tds.map(t => t.textContent.trim()));
    check('6: price column with "EUR" suffix sorts numerically', JSON.stringify(prices.map(p => parseFloat(p.replace(/\s/g,'').replace(',','.')))) === JSON.stringify([200,250,400,410]), prices);

    check('no page errors', errors.length === 0, errors);
    await page.close();
  }

  // ── SPY covering the whole period → XML benchmark used, starts at 0 % ──
  {
    const { page, errors } = await open(browser, { vat: 'lines', spyFull: true });
    await page.click('#btn-spx');
    const bm = await page.evaluate(() => document.getElementById('chart-canvas')._chartMeta.allSeries.find(s => s.key==='spx')?.vals);
    check('2: full SPY from XML used, 0 % → +5 %', bm && near(bm[0], 0) && near(bm.at(-1), 5), bm);
    // (7) VAT already booked as its own rows → nothing added
    const vat = await page.evaluate(() => _ofRows.reduce((s,c) => s + ofVat(c), 0));
    check('7: lines mode — no extra VAT', near(vat, 0), vat);
    const note = await page.textContent('#of-vat-note');
    check('7: lines mode note shown', note.includes('samostatné řádky'), note);
    check('no page errors', errors.length === 0, errors);
    await page.close();
  }

  // ── VAT from Sales Tax Details ──
  {
    const { page, errors } = await open(browser, { vat: 'ib' });
    const vat = await page.evaluate(() => _ofRows.map(c => ofVat(c)));
    check('7: ib mode — VAT matched by transaction (-2.1, 0)', near(vat[0], -2.1) && near(vat[1], 0), vat);
    check('no page errors', errors.length === 0, errors);
    await page.close();
  }

  // ── EUR base account → labels follow the base currency ──
  {
    const { page, errors, title } = await open(browser, { base: 'EUR' }, '25');
    check('3: EUR base — rate dialog title', title === 'Kurz EUR / CZK', title);
    const th = await page.$$eval('#tbl-pos th', ths => ths.map(t => t.textContent));
    check('3: EUR base — headers relabelled', th.includes('Trž. hodnota EUR') && !th.some(t => /USD/.test(t)), th);
    const hdr = await page.textContent('#hdr-rate');
    check('3: EUR base — header rate label', hdr.startsWith('EUR/CZK'), hdr);
    check('no page errors', errors.length === 0, errors);
    await page.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
