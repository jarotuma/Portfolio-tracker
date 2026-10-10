// Writes samples/ukazkovy-flex-report.xml from the generator embedded in ReportReader.html
// (<script id="sample-data">), so the file and the in-page sample are always the same data.
// Usage: npm run sample
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'ReportReader.html'), 'utf8');
const m = html.match(/<script id="sample-data">([\s\S]*?)<\/script>/);
if (!m) throw new Error('sample-data script not found in ReportReader.html');
const ctx = {};
vm.runInNewContext(m[1] + '\nthis.xml = buildSampleFlexXML();', ctx);
const out = path.join(__dirname, 'ukazkovy-flex-report.xml');
fs.writeFileSync(out, ctx.xml);
console.log(`${path.relative(process.cwd(), out)} (${ctx.xml.length} B)`);
