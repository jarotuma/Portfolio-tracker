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

  // ── Manual salary and rent per month ──
  {
    const { page, errors } = await open(browser, { income: true });
    await page.evaluate(() => { localStorage.removeItem('rr-income-manual'); MANUAL.saved = {}; });
    await page.click('.tab:has-text("Příjmy")');
    const z = await page.evaluate(() => incomeByMonth([], ['202603', '202604']).map(r => [r.month, r.net, r.salary, r.rent]));
    check('manual income: months without investment income get a row', JSON.stringify(z) === JSON.stringify([['202603', 0, 0, 0], ['202604', 0, 0, 0]]), z);
    const jan = '[data-month="202601"]';
    await page.fill(`.man-in${jan}[data-k="salary"]`, '60 000');
    await page.press(`.man-in${jan}[data-k="salary"]`, 'Tab');
    const focus = await page.evaluate(() => document.activeElement?.dataset?.k + document.activeElement?.dataset?.month);
    check('manual income: Tab moves on to the rent field (focus not lost)', focus === 'rent202601', focus);
    await page.keyboard.type('15000,50');
    await page.keyboard.press('Tab');
    const tot = await page.textContent('#inc-tot-202601');
    // investments 170.94 × 23 = 3 931.62 + 60 000 + 15 000.50
    check('manual income: monthly total = investments in Kč + salary + rent', near(parseFloat(tot.replace(/\s/g, '').replace(',', '.')), 78932, 1), tot);
    const cards = (await page.textContent('#cards-inc')).replace(/\s+/g, ' ');
    check('manual income: whole-period cards show salary 60 000 and rent', cards.includes('60 000 Kč') && cards.includes('15 001 Kč'), cards);
    await page.click('#tbl-inc-month tbody tr:has-text("leden 2026") td.left');
    const cardsJan = (await page.textContent('#cards-inc')).replace(/\s+/g, ' ');
    check('manual income: selected month card "Příjem celkem" = 78 932 Kč', cardsJan.includes('Příjem celkem') && cardsJan.includes('78 932 Kč'), cardsJan);
    const dec = await page.evaluate(() => ({ salary: _incMonths.find(m => m.month === '202512').salary }));
    check('manual income: other month untouched', dec.salary === 0, dec);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rr-income-manual')));
    check('manual income: saved in the browser', saved?.['202601']?.salary === 60000 && saved?.['202601']?.rent === 15000.5, saved);
    await page.evaluate(async () => { for (let i = 0; i < 50 && !(await localMetas()).some(m => m.kind === 'report'); i++) await new Promise(r => setTimeout(r, 100)); });
    await page.reload();
    await page.waitForSelector('#app.visible');               // the saved report opens by itself
    await page.click('.tab:has-text("Příjmy")');
    const again = await page.inputValue(`.man-in${jan}[data-k="salary"]`);
    check('manual income: remembered after reload', again.replace(/\s/g, '') === '60000', again);
    await page.fill(`.man-in${jan}[data-k="salary"]`, '');
    await page.press(`.man-in${jan}[data-k="salary"]`, 'Tab');
    const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('rr-income-manual'))['202601']);
    check('manual income: emptying a field removes it', cleared.salary === undefined && cleared.rent === 15000.5, cleared);
    const dl = page.waitForEvent('download');
    await page.click('button:has-text("Excel export")');
    const file = path.join(OUT, 'export_manual.xlsx');
    await (await dl).saveAs(file);
    const inc = XLSXN.utils.sheet_to_json(XLSXN.readFile(file).Sheets['Příjmy po měsících'], { header: 1 });
    const hdr = inc[0], total = inc.find(r => r[0] === 'Celkem');
    check('manual income: Excel has salary, rent and total columns', hdr.slice(-3).join() === 'Výplata Kč,Nájem Kč,Příjem celkem Kč' && total[11] === 15000.5, [hdr.slice(-3), total]);
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
    await page.click('.tab:has-text("Příjmy")');
    const demo = await page.evaluate(() => ({ s: _incMonths.map(m => m.salary).join(), r: _incMonths.map(m => m.rent).join() }));
    check('sample: demo salary and rent filled in', demo.s === '62000,62000,98000,62000,62000,64000' && demo.r === '15000,15000,15000,16500,16500,16500', demo);
    await page.fill('.man-in[data-month="202601"][data-k="salary"]', '1');
    await page.press('.man-in[data-month="202601"][data-k="salary"]', 'Tab');
    const leaked = await page.evaluate(() => localStorage.getItem('rr-income-manual'));
    check('sample: edits are not saved to the browser', leaked === null, leaked);
    const s = await page.evaluate(() => ({
      trades: G.data.trades.length, pos: G.data.positions.length, eur: G.data.positions.filter(p => p.currency === 'EUR').length,
      manual: G.data.derivatives.filter(d => !d.underlyingPrice).length, vat: G.data.vatMode,
      twrIb: G.data.changeInNAV.twr, twrDaily: dailyTWR(G.data.equitySeries, G.data.flowsByDate).at(-1),
    }));
    check('sample: trades, positions incl. EUR, one option needing a manual underlying price',
      s.trades === 24 && s.pos === 11 && s.eur >= 3 && s.manual === 1, s);
    check('sample: IB TWR in the file matches TWR from daily values', near(s.twrIb, s.twrDaily, 0.001), s);
    await page.click('.tab:has-text("Přehled")');
    await page.click('#btn-spx');
    const bm = await page.evaluate(() => document.getElementById('chart-canvas')._chartMeta.allSeries.find(x => x.key === 'spx')?.vals);
    check('sample: S&P 500 benchmark from the XML, starts at 0 %', bm && bm[0] === 0 && bm.every(v => v != null), bm && bm.slice(0, 3));
    check('no page errors', errors.length === 0, errors);
    await page.close();
  }

  // ── Taxes: unified rates, time test, 100 000 Kč limit, options, dividends by country ──
  {
    const { page, errors } = await open(browser, { income: true, lots: true });
    await page.evaluate(() => { localStorage.clear(); TAX.unified = {}; TAX.daily = {}; indexDaily(); TAX.method = 'unified'; TAX.all100k = false; });
    await page.click('.tab:has-text("Daně")');
    const years = await page.$$eval('#tax-year option', o => o.map(x => x.value));
    check('tax: years from sales and dividends, latest selected', JSON.stringify(years) === JSON.stringify(['2025', '2026']) &&
      await page.inputValue('#tax-year') === '2026', years);
    // GFŘ values prefilled for 2022 EUR and 2025 USD, 2026 missing
    const src = await page.$$eval('.rate-in', i => i.map(x => `${x.dataset.ccy}${x.dataset.year}=${x.value}`));
    check('tax: unified rates prefilled from GFŘ, 2026 empty', src.includes('EUR2022=24,54') && src.includes('USD2025=21,84') &&
      src.includes('EUR2026=') && src.includes('USD2026='), src);
    const warn0 = await page.textContent('#tax-warnings');
    check('tax: missing 2026 rate reported', warn0.includes('EUR 2026') && warn0.includes('USD 2026'), warn0);
    await page.fill('.rate-in[data-ccy="EUR"][data-year="2026"]', '24');
    await page.dispatchEvent('.rate-in[data-ccy="EUR"][data-year="2026"]', 'change');
    await page.fill('.rate-in[data-ccy="USD"][data-year="2026"]', '21');
    await page.dispatchEvent('.rate-in[data-ccy="USD"][data-year="2026"]', 'change');
    const T = await page.evaluate(() => {
      const t = _tax;
      const lot = s => t.sec.concat(t.der).find(r => r.symbol.startsWith(s));
      const pick = r => ({ income: r.income, expense: r.expense, profit: r.profit, tt: r.timeTest, status: r.status });
      return { source: t.source, sap: pick(lot('SAP')), msft: pick(lot('MSFT')), opt: pick(lot('XYZ')),
               limitBase: t.secT.limitBase, taxable: t.secT.income, div: t.byCountry, missing: t.missing };
    });
    check('tax: closed lots from IB used', T.source === 'ib', T.source);
    check('tax: SAP bought 2022 — time test passed, exempt; income 12 000, expense 11 042,46 (buy at 2022 rate)',
      T.sap.tt === true && T.sap.status === 'timetest' && near(T.sap.income, 12000) && near(T.sap.expense, 11042.46), T.sap);
    check('tax: MSFT held 9 days — no time test, exempt by 100 000 Kč limit; expense uses 2025 rate',
      T.msft.tt === false && T.msft.status === 'limit' && near(T.msft.income, 8610) && near(T.msft.expense, 8740.284), T.msft);
    check('tax: limit base excludes time-tested sale (8 610 Kč), nothing taxable', near(T.limitBase, 8610) && T.taxable === 0, T);
    check('tax: short option — premium 149 USD at 2025 rate is income, buy-back at 2026 rate is expense, profit 2 183,16',
      near(T.opt.income, 3254.16) && near(T.opt.expense, 1071) && near(T.opt.profit, 2183.16) && T.opt.status === 'taxable', T.opt);
    check('tax: dividends by country — DE gross 240, tax −62,4', T.div.length === 1 && T.div[0].country === 'DE' &&
      near(T.div[0].gross, 240) && near(T.div[0].wht, -62.4), T.div);
    check('tax: no missing rates after entering 2026', T.missing.length === 0, T.missing);
    await page.check('#tax-100k-all');
    const lb = await page.evaluate(() => _tax.secT.limitBase);
    check('tax: limit option includes time-tested sales (20 610 Kč)', near(lb, 20610), lb);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rr-unified')));
    check('tax: entered unified rates remembered in the browser', saved?.['2026']?.USD === 21 && saved?.['2026']?.EUR === 24, saved);

    // Daily ČNB rates from an uploaded rok.txt (synthetic test file in ČNB format)
    await page.selectOption('#tax-method', 'daily');
    const cnb = path.join(OUT, 'rok2026.txt');
    fs.writeFileSync(cnb, 'Datum|1 EUR|100 JPY|1 USD\n06.01.2026|24,500|13,600|21,500\n07.01.2026|24,100|13,500|21,100\n08.01.2026|24,200|13,400|21,200\n09.01.2026|24,300|13,300|21,300\n');
    await page.setInputFiles('#tax-rates input[type=file]', cnb);
    await page.waitForFunction(() => _dailySorted.USD?.length === 4);
    const D = await page.evaluate(() => ({ jpy: dailyRate('JPY', '20260107')?.rate, sat: dailyRate('USD', '20260110')?.rate,
      div: _tax.divRows.find(r => r.symbol === 'SAP'), sap: _tax.sec.find(r => r.symbol === 'SAP'), missing: _tax.missing }));
    check('tax daily: "100 JPY" column divided by 100', near(D.jpy, 0.135, 1e-9), D.jpy);
    check('tax daily: weekend uses the last fixing (Sat 10.01. → 09.01.)', near(D.sat, 21.3, 1e-9), D.sat);
    check('tax daily: dividend 07.01. at 24,100 → 241 Kč', near(D.div.gross, 241) && near(D.div.rate, 24.1, 1e-9), D.div);
    check('tax daily: missing 2022 and 2025 rates reported, SAP lot not counted',
      D.sap.status === 'norate' && D.missing.some(([c, y]) => c === 'EUR' && y === '2022'), D);
    const yrs = await page.$$eval('.tax-year', a => a.map(x => x.textContent.trim()));
    check('tax daily: needed years with ČNB download links and status', yrs.some(y => y.startsWith('2026') && y.includes('načteno')) &&
      yrs.some(y => y.startsWith('2022') && y.includes('stáhnout')), yrs);
    await page.selectOption('#tax-method', 'unified');

    const dl = page.waitForEvent('download');
    await page.click('button:has-text("Excel export")');
    const file = path.join(OUT, 'export_tax.xlsx');
    await (await dl).saveAs(file);
    const sh = XLSXN.readFile(file).Sheets['Daně 2026'];
    const rows = sh ? XLSXN.utils.sheet_to_json(sh, { header: 1 }) : [];
    const der = rows.find(r => r[0] === 'Deriváty – příjmy (§ 10)');
    check('tax: Excel sheet "Daně 2026" with derivatives income 3 254', der && der[1] === 3254, der);
    check('no page errors', errors.length === 0, errors);
    await page.evaluate(() => localStorage.clear());
    await page.close();
  }

  // ── Taxes without Closed Lots: FIFO from the report, unknown purchases flagged ──
  {
    const { page, errors } = await open(browser, {});
    await page.evaluate(() => { localStorage.clear(); TAX.unified = {}; TAX.method = 'unified'; });
    await page.click('.tab:has-text("Daně")');
    const T = await page.evaluate(() => ({ source: _tax.source, st: _tax.sec.map(r => `${r.symbol}:${r.status}`), warn: document.getElementById('tax-warnings').textContent }));
    check('tax fallback: FIFO from trades, SAP sale without purchase flagged, MSFT matched to its buy',
      T.source === 'fifo' && T.st.includes('SAP:unknown') && T.st.some(x => x.startsWith('MSFT:')) && !T.st.includes('MSFT:unknown'), T.st);
    check('tax fallback: warning asks for Closed Lots', T.warn.includes('Closed Lots'), T.warn);
    check('no page errors', errors.length === 0, errors);
    await page.close();
  }

  // ── Saved reports: browser storage (IndexedDB) ──
  {
    const ctx = await browser.newContext();                       // one context: storage survives reloads
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    const xml = path.join(OUT, 'persist.xml');
    fs.writeFileSync(xml, fixture({ income: true, lots: true }));
    const upload = async rate => {
      await page.setInputFiles('#file-input', xml);
      await page.fill('#rate-input', String(rate));
      await page.click('#rate-modal button');
      await page.waitForSelector('#app.visible');
    };
    const metas = () => page.evaluate(async () => (await localMetas()).filter(m => m.kind === 'report').map(m => ({ key: m.key, rate: m.rate, enc: m.enc, deleted: !!m.deleted, size: m.size })));
    const settle = () => page.evaluate(async () => { for (let i = 0; i < 50 && !(await localMetas()).length; i++) await new Promise(r => setTimeout(r, 100)); });
    await page.goto('file://' + PAGE);
    check('saved: nothing saved at first, list hidden', (await metas()).length === 0 && await page.isHidden('#saved-box'));
    await upload(21.5); await settle();
    let m = await metas();
    check('saved: uploaded report stored compressed with its rate', m.length === 1 && m[0].rate === 21.5 && m[0].enc === 'gzip' && m[0].key.startsWith('rep_U1234567_'), m);
    const nTrades = await page.evaluate(() => G.data.trades.length);
    await page.reload();
    await page.waitForSelector('#app.visible');
    const hdr = await page.textContent('#hdr-rate');
    const nAfter = await page.evaluate(() => G.data.trades.length);
    check('saved: after reload the report opens by itself with the saved rate', hdr.includes('21.5000') && nAfter === nTrades && nTrades > 0, [hdr, nAfter, nTrades]);
    await page.click('button:has-text("Uložené reporty")');
    const rows = await page.$$eval('.saved-row .nm', r => r.map(x => x.textContent));
    check('saved: list on the start screen shows the account', rows.length === 1 && rows[0].includes('Test User'), rows);
    check('saved: back button available while a report is open', await page.isVisible('#btn-back'));
    await page.click('#btn-back');
    await upload(23);
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    m = await metas();
    check('saved: uploading the same period again replaces it (still one, rate 23)', m.length === 1 && m[0].rate === 23, m);
    await page.click('#hdr-rate'); await page.fill('#rate-input', '25'); await page.click('#rate-modal button');
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    m = await metas();
    check('saved: changing the rate updates the saved report', m[0].rate === 25, m);
    await page.click('button:has-text("Uložené reporty")');
    await page.click('.saved-open');
    check('saved: opening from the list works', await page.isVisible('#app.visible') && (await page.textContent('#hdr-rate')).includes('25.0000'));
    // ČNB rates persist across reloads
    await page.click('.tab:has-text("Daně")');
    await page.selectOption('#tax-method', 'daily');
    const cnb = path.join(OUT, 'rok2026p.txt');
    fs.writeFileSync(cnb, 'Datum|1 EUR|1 USD\n06.01.2026|24,500|21,500\n07.01.2026|24,100|21,100\n08.01.2026|24,200|21,200\n09.01.2026|24,300|21,300\n');
    await page.setInputFiles('#tax-rates input[type=file]', cnb);
    await page.waitForFunction(() => _dailySorted.USD?.length === 4);
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await page.reload(); await page.waitForSelector('#app.visible');
    await page.waitForFunction(() => _dailySorted.USD?.length === 4);
    check('saved: ČNB daily rates remembered after reload', true);
    // sample is never saved
    await page.click('button:has-text("Uložené reporty")');
    await page.click('button:has-text("Vyzkoušet na ukázkových datech")'); await page.click('#rate-modal button');
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    check('saved: the sample report is not saved', (await metas()).length === 1, await metas());
    // delete: two clicks, then no auto-open
    await page.click('button:has-text("Uložené reporty")');
    await page.click('.saved-del');
    check('saved: first click on Smazat only asks to confirm', (await metas()).every(x => !x.deleted) && await page.isVisible('.saved-del.confirm'));
    await page.click('.saved-del');
    await page.waitForFunction(() => document.getElementById('saved-box').hidden);
    m = await metas();
    check('saved: confirmed delete removes the report (tombstone kept for sync)', m.length === 1 && m[0].deleted && m[0].size === undefined, m);
    await page.reload();
    await page.waitForTimeout(600);
    check('saved: after delete nothing opens by itself', await page.isHidden('#app') || !(await page.evaluate(() => !!G.data)));
    // saving can be switched off
    await page.uncheck('#opt-save');
    await upload(22);
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    check('saved: with "Ukládat" off nothing new is stored', (await metas()).every(x => x.deleted), await metas());
    check('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  // ── Saved reports: private cloud sync (database mocked, shared by two "devices") ──
  {
    const cloud = new Map();
    let maxDoc = 0;
    const cloudOp = (op, p, d) => {
      if (op === 'get') return cloud.has(p) ? cloud.get(p) : null;
      if (op === 'set') { const j = JSON.stringify(d); maxDoc = Math.max(maxDoc, j.length); if (j.length > 262144) throw new Error('over 256 KiB'); cloud.set(p, JSON.parse(j)); return null; }
      if (op === 'delete') { cloud.delete(p); return null; }
      if (op === 'list') return [...cloud].filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(([k, v]) => [k.split('/').pop(), v]);
    };
    const device = async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', e => page.errors.push(e.message));
      await page.exposeFunction('__cloud', cloudOp);
      await page.addInitScript(() => {
        const ref = p => ({ id: p.split('/').pop(), path: p,
          get: async () => { const d = await window.__cloud('get', p); return { id: p.split('/').pop(), exists: d != null, data: () => d ?? undefined }; },
          set: d => window.__cloud('set', p, JSON.parse(JSON.stringify(d))), delete: () => window.__cloud('delete', p),
          collection: c => col(p + '/' + c) });
        const col = p => ({ path: p, doc: id => ref(p + '/' + id),
          get: async () => { const rows = await window.__cloud('list', p); return { docs: rows.map(([id, d]) => ({ id, exists: true, data: () => d })), size: rows.length }; } });
        window.claude = { use: async n => n === 'user' ? { id: async () => 'u_test1' } : n === 'db' ? { doc: ref, collection: col } : null };
      });
      await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
      await page.goto('file://' + PAGE);
      await page.waitForFunction(() => PERSIST.cloudState !== 'checking');
      return { ctx, page };
    };
    const flush = page => page.evaluate(async () => { clearTimeout(_syncTimer); await syncAll(); });

    // Device A: big report (incompressible padding → several chunks) + salary
    const big = fixture({ income: true, lots: true }).replace('</FlexQueryResponse>',
      '<!--' + require('crypto').randomBytes(300000).toString('base64') + '-->\n</FlexQueryResponse>');
    const bigPath = path.join(OUT, 'big.xml'); fs.writeFileSync(bigPath, big);
    const A = await device();
    check('cloud: signed-in page offers synchronization', await A.page.evaluate(() => PERSIST.cloudState) === 'ready' && await A.page.isVisible('#opt-sync-lbl'));
    await A.page.setInputFiles('#file-input', bigPath);
    await A.page.fill('#rate-input', '22.75'); await A.page.click('#rate-modal button');
    await A.page.waitForSelector('#app.visible');
    await A.page.evaluate(async () => { for (let i = 0; i < 50 && !(await localMetas()).length; i++) await new Promise(r => setTimeout(r, 100)); });
    await A.page.click('.tab:has-text("Příjmy")');
    await A.page.fill('.man-in[data-month="202601"][data-k="salary"]', '70000');
    await A.page.press('.man-in[data-month="202601"][data-k="salary"]', 'Tab');
    await flush(A.page);
    const keys = [...cloud.keys()];
    const metaKey = keys.find(k => k.includes('/idx/meta/rep_'));
    const meta = cloud.get(metaKey);
    check('cloud: report stored in the private subtree data/users/<id>/', keys.length > 0 && keys.every(k => k.startsWith('data/users/u_test1/')), keys.slice(0, 3));
    check('cloud: large report split into chunks, every document under 256 KiB', meta?.chunks >= 3 && maxDoc < 262144 &&
      keys.filter(k => k.includes('/idx/chunks/')).length === meta.chunks, [meta?.chunks, maxDoc]);
    const st = cloud.get('data/users/u_test1/settings');
    check('cloud: settings doc has salary and the last opened report', st?.manual?.['202601']?.salary === 70000 && st.lastOpened === meta.key, st);

    // Device B: empty browser, same account → report arrives and opens by itself
    const B = await device();
    await B.page.waitForSelector('#app.visible', { timeout: 20000 });
    const b = await B.page.evaluate(() => ({ rate: G.rate, trades: G.data.trades.length, salary: MANUAL.saved['202601']?.salary, name: G.data.account.name }));
    const a = await A.page.evaluate(() => ({ trades: G.data.trades.length }));
    check('cloud: second device gets the report, rate and salary and opens it', b.rate === 22.75 && b.trades === a.trades && b.salary === 70000 && b.name === 'Test User', b);
    // delete on B → gone in the cloud and on A
    await B.page.click('button:has-text("Uložené reporty")');
    await B.page.click('.saved-del'); await B.page.click('.saved-del');
    await B.page.waitForFunction(() => document.getElementById('saved-box').hidden);
    await flush(B.page);
    const after = [...cloud.keys()];
    check('cloud: delete removes the chunks and leaves a tombstone', after.filter(k => k.includes('/idx/chunks/')).length === 0 && cloud.get(metaKey)?.deleted === true, after);
    await flush(A.page);
    const aMeta = await A.page.evaluate(async () => (await localMetas()).filter(m => m.kind === 'report').map(m => !!m.deleted));
    check('cloud: the delete reaches the first device', aMeta.length === 1 && aMeta[0] === true, aMeta);
    // sync switched off → no cloud writes
    await A.page.click('button:has-text("Uložené reporty")');
    await A.page.uncheck('#opt-sync');
    const before = JSON.stringify([...cloud]);
    await A.page.setInputFiles('#file-input', bigPath); await A.page.fill('#rate-input', '20'); await A.page.click('#rate-modal button');
    await A.page.evaluate(() => new Promise(r => setTimeout(r, 1800)));
    check('cloud: with synchronization off nothing is written', JSON.stringify([...cloud]) === before);
    check('no page errors', A.page.errors.length === 0 && B.page.errors.length === 0, [A.page.errors, B.page.errors]);
    await A.ctx.close(); await B.ctx.close();
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
