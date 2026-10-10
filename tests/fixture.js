// Synthetic IB Flex Query XML for testing ReportReader.
// opts.vat: 'calc' | 'lines' | 'ib'; opts.spyFull: SPY prices cover whole period; opts.base;
// opts.income: extra December dividend + option sell/close trades (two months of income)
// opts.lots: IB Closed Lots for the sales (purchase dates for the time test)
// opts.second: a second account (own FlexStatement) with a query that lacks Level of Detail, cash Type and Open Date/Time
module.exports = function fixture(opts = {}) {
  const base = opts.base || 'USD';
  const days = ['20260102','20260105','20260106','20260107','20260108','20260109'];
  const totals = [10000, 10100, 15150, 15000, 15300, 15453];
  const eq = days.map((d,i) => `<EquitySummaryByReportDateInBase reportDate="${d}" stock="${totals[i]*0.8}" options="${i*10-20}" total="${totals[i]}"/>`).join('\n');

  const spyDays = opts.spyFull ? days : days.slice(3);
  const spy = spyDays.map((d,i) => `<PriorPeriodPosition symbol="SPY" date="${d}" price="${500 + i*5}"/>`).join('\n');

  const fees = [
    `<CashTransaction type="Other Fees" currency="USD" fxRateToBase="1" amount="-10" description="Market data NYSE" dateTime="20260105" transactionID="T1"/>`,
    `<CashTransaction type="Other Fees" currency="USD" fxRateToBase="1" amount="-4.5" description="Snapshot fee" dateTime="20260106" transactionID="T2"/>`,
  ];
  if (opts.vat === 'lines') fees.push(`<CashTransaction type="Other Fees" currency="USD" fxRateToBase="1" amount="-2.1" description="VAT on market data" dateTime="20260105" transactionID="T3"/>`);
  const salesTax = opts.vat === 'ib'
    ? `<SalesTaxes><SalesTax currency="USD" fxRateToBase="1" salesTax="-2.1" taxableTransactionID="T1" transactionID="S1"/></SalesTaxes>` : '';

  const optTrades = opts.income ? `
<Trade levelOfDetail="EXECUTION" symbol="XYZ 260320C00050000" description="XYZ C50" assetCategory="OPT" buySell="SELL" currency="USD" fxRateToBase="1" quantity="-1" tradePrice="1.5" proceeds="150" ibCommission="-1" ibCommissionCurrency="USD" netCash="149" fifoPnlRealized="0" dateTime="20251231;150000"/>
<Trade levelOfDetail="EXECUTION" symbol="XYZ 260320C00050000" description="XYZ C50" assetCategory="OPT" buySell="BUY" currency="USD" fxRateToBase="1" quantity="1" tradePrice="0.5" proceeds="-50" ibCommission="-1" ibCommissionCurrency="USD" netCash="-51" fifoPnlRealized="98" dateTime="20260108;150000"/>` : '';
  const lots = opts.lots ? `
<Lot levelOfDetail="CLOSED_LOT" symbol="SAP" assetCategory="STK" currency="EUR" fxRateToBase="1.1" buySell="SELL" quantity="-2" openDateTime="20220110;100000" cost="449" fifoPnlRealized="50" dateTime="20260108;100000"/>
<Lot levelOfDetail="CLOSED_LOT" symbol="MSFT" assetCategory="STK" currency="USD" fxRateToBase="1" buySell="SELL" quantity="-1" openDateTime="20251231;100000" cost="400.1" fifoPnlRealized="9.8" dateTime="20260109;100000"/>${opts.income ? `
<Lot levelOfDetail="CLOSED_LOT" symbol="XYZ 260320C00050000" assetCategory="OPT" currency="USD" fxRateToBase="1" buySell="BUY" quantity="1" openDateTime="20251231;150000" cost="-149" fifoPnlRealized="98" dateTime="20260108;150000"/>` : ''}` : '';
  const decDiv = opts.income
    ? `<CashTransaction type="Dividends" symbol="AAPL" isin="US0378331005" currency="USD" fxRateToBase="1" amount="5" description="AAPL dividend" dateTime="20251215" transactionID="V0"/>` : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="test" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20260102" toDate="20260109">
<AccountInformation accountId="U1234567" name="Test User" currency="${base}"/>
<ChangeInNAV twr="2.5" mtm="300" depositsWithdrawals="4900" startingValue="10000" endingValue="15453"/>
<CashReport><CashReportCurrency currency="BASE_SUMMARY" dividends="11" withholdingTax="-2.86" commissions="-2.1" brokerInterest="0" otherFees="-14.5" endingCash="1000" startingCash="500"/></CashReport>
<Trades>
<Trade levelOfDetail="EXECUTION" symbol="AAPL" description="APPLE INC" assetCategory="STK" buySell="BUY" currency="USD" fxRateToBase="1" quantity="5" tradePrice="200" proceeds="-1000" ibCommission="-1" ibCommissionCurrency="USD" netCash="-1001" fifoPnlRealized="0" dateTime="20260105;100000"/>
<Trade levelOfDetail="EXECUTION" symbol="SAP" description="SAP SE" assetCategory="STK" buySell="SELL" currency="EUR" fxRateToBase="1.1" quantity="-2" tradePrice="250" proceeds="500" ibCommission="-1" ibCommissionCurrency="EUR" netCash="499" fifoPnlRealized="50" dateTime="20260108;100000"/>
<Trade levelOfDetail="EXECUTION" symbol="MSFT" description="MICROSOFT" assetCategory="STK" buySell="BUY" currency="USD" fxRateToBase="1" quantity="1" tradePrice="400" proceeds="-400" ibCommission="-0.1" ibCommissionCurrency="USD" netCash="-400.1" fifoPnlRealized="0" dateTime="20251231;100000"/>
<Trade levelOfDetail="EXECUTION" symbol="MSFT" description="MICROSOFT" assetCategory="STK" buySell="SELL" currency="USD" fxRateToBase="1" quantity="-1" tradePrice="410" proceeds="410" ibCommission="-0.1" ibCommissionCurrency="USD" netCash="409.9" fifoPnlRealized="9.8" dateTime="20260109;100000"/>${optTrades}${lots}
</Trades>
<OpenPositions>
<OpenPosition levelOfDetail="SUMMARY" symbol="AAPL" assetCategory="STK" currency="USD" fxRateToBase="1" position="10" openPrice="190" markPrice="210" positionValue="2100" costBasisMoney="1900" fifoPnlUnrealized="200" percentOfNAV="13" side="Long" description="APPLE INC" isin="US0378331005"/>
<OpenPosition levelOfDetail="SUMMARY" symbol="SAP" assetCategory="STK" currency="EUR" fxRateToBase="1.1" position="8" openPrice="100" markPrice="120" positionValue="960" costBasisMoney="800" fifoPnlUnrealized="160" percentOfNAV="6" side="Long" description="SAP SE" isin="DE0007164600"/>
<OpenPosition levelOfDetail="SUMMARY" symbol="AAPL 260320C00200000" assetCategory="OPT" currency="USD" fxRateToBase="1" conid="1001" underlyingSymbol="AAPL" expiry="20260320" putCall="C" strike="200" position="1" multiplier="100" costBasisMoney="500" markPrice="12" positionValue="1200" fifoPnlUnrealized="700" side="Long" description="AAPL C200"/>
<OpenPosition levelOfDetail="SUMMARY" symbol="SAP 260320P00100000" assetCategory="OPT" currency="EUR" fxRateToBase="1.1" conid="1002" underlyingSymbol="SAP" expiry="20260320" putCall="P" strike="100" position="-2" multiplier="100" costBasisMoney="-300" markPrice="1" positionValue="-200" fifoPnlUnrealized="100" side="Short" description="SAP P100"/>
<OpenPosition levelOfDetail="SUMMARY" symbol="XYZ 260320C00050000" assetCategory="OPT" currency="USD" fxRateToBase="1" conid="1003" underlyingSymbol="XYZ" expiry="20260320" putCall="C" strike="50" position="1" multiplier="100" costBasisMoney="200" markPrice="3" positionValue="300" fifoPnlUnrealized="100" side="Long" description="XYZ C50"/>
<OpenPosition levelOfDetail="SUMMARY" symbol="XYZ 260320P00040000" assetCategory="OPT" currency="USD" fxRateToBase="1" conid="1004" underlyingSymbol="XYZ" expiry="20260320" putCall="P" strike="40" position="1" multiplier="100" costBasisMoney="100" markPrice="1" positionValue="100" fifoPnlUnrealized="0" side="Long" description="XYZ P40"/>
</OpenPositions>
<CashTransactions>
<CashTransaction type="Deposits/Withdrawals" currency="USD" fxRateToBase="1" amount="5000" description="Deposit" dateTime="20260106;100000" reportDate="20260106" transactionID="D1"/>
<CashTransaction type="Deposits/Withdrawals" currency="USD" fxRateToBase="1" amount="-100" description="Withdrawal" dateTime="20260103;100000" reportDate="20260103" transactionID="D2"/>
<CashTransaction type="Dividends" symbol="SAP" isin="DE0007164600" currency="EUR" fxRateToBase="1.1" amount="10" description="SAP dividend" dateTime="20260107" transactionID="V1"/>
<CashTransaction type="Withholding Tax" symbol="SAP" isin="DE0007164600" currency="EUR" fxRateToBase="1.1" amount="-2.6" description="SAP tax" dateTime="20260107" transactionID="V2"/>
${decDiv}
${fees.join('\n')}
</CashTransactions>
${salesTax}
<FIFOPerformanceSummaryInBase>
<FIFOPerformanceSummaryUnderlying symbol="SAP" description="SAP SE" assetCategory="STK" realizedSTProfit="55" realizedSTLoss="0" totalRealizedPnl="55" totalUnrealizedPnl="176" totalFifoPnl="231"/>
<FIFOPerformanceSummaryUnderlying symbol="AAPL" description="APPLE INC" assetCategory="STK" realizedSTProfit="0" realizedSTLoss="0" totalRealizedPnl="0" totalUnrealizedPnl="200" totalFifoPnl="200"/>
</FIFOPerformanceSummaryInBase>
<MTMPerformanceSummaryInBase>
<MTMPerformanceSummaryUnderlying symbol="SAP" assetCategory="STK" currency="EUR" prevCloseQuantity="10" prevClosePrice="110" closeQuantity="8" closePrice="120"/>
<MTMPerformanceSummaryUnderlying symbol="AAPL" assetCategory="STK" currency="USD" prevCloseQuantity="5" prevClosePrice="200" closeQuantity="10" closePrice="210"/>
</MTMPerformanceSummaryInBase>
<EquitySummaryInBase>
${eq}
</EquitySummaryInBase>
<PriorPeriodPositions>
${spy}
</PriorPeriodPositions>
</FlexStatement></FlexStatements></FlexQueryResponse>`;

  if (!opts.second) return xml;
  const B = 'U7654321';
  const second = `<FlexStatement accountId="${B}" fromDate="20260102" toDate="20260109" period="Custom">
<AccountInformation accountId="${B}" name="Test User" currency="${base}"/>
<ChangeInNAV accountId="${B}" startingValue="0" endingValue="1150" depositsWithdrawals="1000" mtm="150"/>
<Trades>
<Trade accountId="${B}" symbol="SAP" assetCategory="STK" currency="EUR" fxRateToBase="1.1" buySell="BUY" quantity="1" tradePrice="250" proceeds="-250" ibCommission="-1" netCash="-251" fifoPnlRealized="0" dateTime="20260107;100000" tradeDate="20260107"/>
<Lot accountId="${B}" symbol="KO" assetCategory="STK" currency="USD" fxRateToBase="1" buySell="SELL" quantity="-1" tradePrice="65" proceeds="65" ibCommission="-1" netCash="64" cost="60" fifoPnlRealized="4" dateTime="20260108;100000" tradeDate="20260108"/>
</Trades>
<OpenPositions>
<OpenPosition accountId="${B}" symbol="SAP" assetCategory="STK" currency="EUR" fxRateToBase="1.1" position="1" markPrice="120" positionValue="120" costBasisMoney="100" fifoPnlUnrealized="20" percentOfNAV="10"/>
</OpenPositions>
<CashTransactions>
<CashTransaction accountId="${B}" currency="USD" fxRateToBase="1" amount="1000" description="CASH RECEIPTS / ELECTRONIC FUND TRANSFERS" dateTime="20260107" reportDate="20260107"/>
<CashTransaction accountId="${B}" currency="CZK" amount="50000" description="CASH RECEIPTS / ELECTRONIC FUND TRANSFERS" dateTime="20260109" reportDate="20260109"/>
<CashTransaction accountId="${B}" symbol="KO" currency="USD" fxRateToBase="1" amount="3" description="KO(US1912161007) CASH DIVIDEND USD 0.1 PER SHARE (Ordinary Dividend)" dateTime="20260108" reportDate="20260108"/>
<CashTransaction accountId="${B}" symbol="KO" currency="USD" fxRateToBase="1" amount="-0.45" description="KO(US1912161007) CASH DIVIDEND USD 0.1 PER SHARE - US TAX" dateTime="20260108" reportDate="20260108"/>
<CashTransaction accountId="${B}" currency="USD" fxRateToBase="1" amount="-5" description="NYSE MARKET DATA FEE FOR JAN 2026" dateTime="20260108" reportDate="20260108"/>
</CashTransactions>
<Transfers>
<Transfer accountId="${B}" currency="USD" fxRateToBase="1" date="20260107" direction="IN" symbol="KO" positionAmountInBase="500" type="ACATS"/>
<Transfer accountId="${B}" currency="USD" fxRateToBase="1" date="20260108" direction="OUT" symbol="KO" positionAmountInBase="100" type="FOP"/>
</Transfers>
<EquitySummaryInBase>
<EquitySummaryByReportDateInBase accountId="${B}" reportDate="20260107" stock="100" options="0" total="1100"/>
<EquitySummaryByReportDateInBase accountId="${B}" reportDate="20260108" stock="100" options="0" total="1150"/>
</EquitySummaryInBase>
</FlexStatement>`;
  return xml.replace('<FlexStatements count="1">', '<FlexStatements count="2">').replace('</FlexStatements>', second + '\n</FlexStatements>');
};
