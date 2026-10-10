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
  const xmlPath = path.join(OUT, `fx_${opts.vat || 'calc'}_${opts.spyFull ? 'full' : 'part'}_${opts.base || 'USD'}${opts.income ? '_inc' : ''}.xml`);
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

  // ── Income by month: dividends, stock sales, options ──
  {
    const { page, errors } = await open(browser, { income: true });
    await page.click('.tab:has-text("Příjmy")');
    const months = await page.$$eval('#tbl-inc-month tbody td:first-child', tds => tds.map(t => t.textContent.trim()));
    check('income: two months listed', JSON.stringify(months) === JSON.stringify(['prosinec 2025', 'leden 2026']), months);
    const agg = await page.evaluate(() => _incMonths);
    const [dec, jan] = agg;
    check('income: December — dividend 5, option premium 150, net 5',
      near(dec.divGross, 5) && near(dec.optRecv, 150) && near(dec.optPnl, 0) && near(dec.net, 5), dec);
    check('income: January — div 11, tax −2.86, stock proceeds 960 (SAP in EUR + MSFT), stock P&L 64.8',
      near(jan.divGross, 11) && near(jan.wht, -2.86) && near(jan.stkProceeds, 960) && near(jan.stkPnl, 64.8), jan);
    check('income: January — option premium paid −50, option P&L 98, net 170.94',
      near(jan.optPaid, -50) && near(jan.optPnl, 98) && near(jan.net, 170.94), jan);

    await page.click('#tbl-inc-month tbody tr:has-text("leden 2026")');
    const sel = await page.inputValue('#filter-inc-month');
    check('income: clicking a month row selects it', sel === '202601', sel);
    const period = await page.textContent('#inc-period');
    const cards = (await page.textContent('#cards-inc')).replace(/\s+/g, ' ');
    check('income: cards show January net income', period === 'leden 2026' && cards.includes('+170,94 USD'), cards);
    const nTx = await page.$$eval('#tbl-inc tbody tr', trs => trs.length);
    check('income: January transactions (div, tax, 2 stock sales, 1 option) = 5', nTx === 5, nTx);
    await page.selectOption('#filter-inc-kind', 'opt');
    const optRows = await page.$$eval('#tbl-inc tbody tr td:nth-child(3)', tds => tds.map(t => t.textContent.trim()));
    check('income: kind filter "Opce" in January → 1 option trade', optRows.length === 1 && optRows[0].startsWith('XYZ'), optRows);
    await page.click('#tbl-inc-month tbody tr:has-text("leden 2026")');
    const sel2 = await page.inputValue('#filter-inc-month');
    const nOpt = await page.$$eval('#tbl-inc tbody tr', trs => trs.length);
    check('income: clicking the month again → whole period (2 option trades)', sel2 === '' && nOpt === 2, [sel2, nOpt]);

    const dl = page.waitForEvent('download');
    await page.click('button:has-text("Excel export")');
    const file = path.join(OUT, 'export_income.xlsx');
    await (await dl).saveAs(file);
    const inc = XLSXN.utils.sheet_to_json(XLSXN.readFile(file).Sheets['Příjmy po měsících'], { header: 1 });
    const total = inc.find(r => r[0] === 'Celkem');
    check('income: Excel sheet total net income 175.94 (CZK × 23 = 4 046.62)', total && near(total[8], 175.94) && near(total[9], 4046.62), total);
    check('no page errors', errors.length === 0, errors);
    await page.close();
  }

  // ── Month filter in Trades and Dividends tabs ──
  {
    const { page, errors } = await open(browser, { income: true });
    await page.click('.tab:has-text("Obchody")');
    const opts = await page.$$eval('#filter-trades-month option', o => o.map(x => x.textContent));
    check('month filter: trades months listed', JSON.stringify(opts) === JSON.stringify(['Všechny měsíce', 'prosinec 2025', 'leden 2026']), opts);
    await page.selectOption('#filter-trades-month', '202512');
    const dec = await page.$$eval('#tbl-trades tbody tr td:first-child', t => t.map(x => x.textContent.trim()));
    const foot = await page.textContent('#tfoot-trades');
    check('month filter: trades in December 2025 = 2, footer labelled', dec.length === 2 && dec.every(d => d.endsWith('12.2025')) && foot.includes('prosinec 2025'), [dec, foot]);
    await page.click('.tab:has-text("Dividendy")');
    await page.selectOption('#filter-divs-month', '202601');
    const n = await page.$$eval('#tbl-divs tbody tr', t => t.length);
    const tot = (await page.textContent('#tfoot-divs')).replace(/\s+/g, ' ');
    check('month filter: January dividends + tax = 2 rows, total +8,14', n === 2 && tot.includes('leden 2026') && tot.includes('+8,14'), [n, tot]);
    check('no page errors', errors.length === 0, errors);
    await page.close();
  }

  // ── Phone width: no horizontal page scroll on any tab ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const xmlPath = path.join(OUT, 'mobile.xml');
    fs.writeFileSync(xmlPath, fixture({ income: true }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await page.goto('file://' + PAGE);
    await page.setInputFiles('#file-input', xmlPath);
    await page.click('#rate-modal button');
    const widths = {};
    for (const tab of await page.$$eval('.tab', t => t.map(x => x.textContent.trim()))) {
      await page.evaluate(t => [...document.querySelectorAll('.tab')].find(e => e.textContent.trim() === t).click(), tab);
      widths[tab] = await page.evaluate(() => document.documentElement.scrollWidth);
    }
    check('mobile: page width stays 390 px on every tab', Object.values(widths).every(w => w <= 390), widths);
    await page.click('.tab:has-text("Přehled")');
    const cols = await page.evaluate(() => getComputedStyle(document.getElementById('cards-usd')).gridTemplateColumns.split(' ').length);
    check('mobile: summary cards in two columns', cols === 2, cols);
    check('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  // ── Built-in sample data (button on the start screen) ──
  {
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await page.goto('file://' + PAGE);
    const dl = page.waitForEvent('download');
    await page.click('button:has-text("Stáhnout ukázkový XML")');
    const xml = fs.readFileSync(await (await dl).path(), 'utf8');
    const committed = fs.readFileSync(path.join(__dirname, '..', 'samples', 'ukazkovy-flex-report.xml'), 'utf8');
    check('sample: downloaded XML = samples/ukazkovy-flex-report.xml (run npm run sample after changing it)', xml === committed, xml.length);
    await page.click('button:has-text("Vyzkoušet na ukázkových datech")');
    await page.click('#rate-modal button');
    await page.waitForSelector('#app.visible');
    const months = await page.$$eval('#filter-inc-month option', o => o.length - 1);
    check('sample: six months of income', months === 6, months);
    const s = await page.evaluate(() => ({
      trades: G.data.trades.length, pos: G.data.positions.length, eur: G.data.positions.filter(p => p.currency === 'EUR').length,
      manual: G.data.derivatives.filter(d => !d.underlyingPrice).length, vat: G.data.vatMode,
      twrIb: G.data.changeInNAV.twr, twrDaily: dailyTWR(G.data.equitySeries, G.data.flowsByDate).at(-1),
    }));
    check('sample: trades, positions incl. EUR, one option needing a manual underlying price',
      s.trades === 24 && s.pos === 11 && s.eur >= 3 && s.manual === 1, s);
    check('sample: IB TWR in the file matches TWR from daily values', near(s.twrIb, s.twrDaily, 0.001), s);
    await page.click('#btn-spx');
    const bm = await page.evaluate(() => document.getElementById('chart-canvas')._chartMeta.allSeries.find(x => x.key === 'spx')?.vals);
    check('sample: S&P 500 benchmark from the XML, starts at 0 %', bm && bm[0] === 0 && bm.every(v => v != null), bm && bm.slice(0, 3));
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
