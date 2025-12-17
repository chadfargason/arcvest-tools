const fs = require('fs');
const path = require('path');

// CONFIG
const RAW_PATHS = [
  process.env.RAW_DATA_PATH,
  'C:\\code\\portfolio_x_ray\\Raw_Data_Dec_17.txt',
  path.join(process.cwd(), '..', 'portfolio_x_ray', 'Raw_Data_Dec_17.txt'),
  path.join(process.cwd(), 'portfolio_x_ray', 'Raw_Data_Dec_17.txt')
].filter(Boolean);

const ANALYSIS_END = '2025-11-30'; // inclusive
const OUT_DIR = path.join(process.cwd(), '..', 'portfolio_x_ray', 'debug_output');
const OUT_CSV = path.join(OUT_DIR, 'fee_audit.csv');

function findRawPath() {
  for (const p of RAW_PATHS) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}

const rawPath = findRawPath();
if (!rawPath) {
  console.error('Raw data file not found. Looked at:', RAW_PATHS);
  process.exit(2);
}

console.log('Using raw data file:', rawPath);
const raw = fs.readFileSync(rawPath, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error('Failed to parse JSON from raw data file:', err.message);
  process.exit(3);
}

const txs = (data.transactions && data.transactions.all_transactions) || [];
const inRange = txs.filter(t => t && t.date && t.date <= ANALYSIS_END);

let feesFieldSum = 0;
let feeTypeSum = 0;
const rows = [];

for (const t of inRange) {
  const date = t.date || '';
  const id = t.investment_transaction_id || t.transaction_id || '';
  const type = t.type || '';
  const subtype = t.subtype || '';
  const amount = typeof t.amount === 'number' ? t.amount : (t.amount ? Number(t.amount) : 0);
  const feesField = typeof t.fees === 'number' ? t.fees : (t.fees ? Number(t.fees) : 0);
  let feeTxAmount = 0;
  if (type === 'fee' && t.amount) {
    feeTxAmount = Math.abs(Number(t.amount));
  }
  const explicitLine = feesField + feeTxAmount;
  feesFieldSum += feesField;
  feeTypeSum += feeTxAmount;
  rows.push({ date, id, type, subtype, amount, feesField, feeTxAmount, explicitLine });
}

// Ensure output dir exists
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Write CSV
const header = 'date,transaction_id,type,subtype,amount,fees_field,fee_transaction_amount,explicit_fee\n';
const csv = header + rows.map(r => [
  r.date,
  '"' + String(r.id).replace(/"/g, '""') + '"',
  r.type,
  r.subtype,
  r.amount.toFixed(2),
  r.feesField.toFixed(2),
  r.feeTxAmount.toFixed(2),
  r.explicitLine.toFixed(2)
].join(',')).join('\n');

fs.writeFileSync(OUT_CSV, csv, 'utf8');

const totalExplicit = feesFieldSum + feeTypeSum;

console.log('Transactions in analysis window (<=', ANALYSIS_END + '):', inRange.length);
console.log('Sum of fees field: $' + feesFieldSum.toFixed(2));
console.log('Sum of fee-type transaction amounts: $' + feeTypeSum.toFixed(2));
console.log('Total explicit fees (fees field + fee tx amounts): $' + totalExplicit.toFixed(2));
console.log('CSV written to:', OUT_CSV);
console.log('Top 20 fee lines:');
rows.slice(0,20).forEach(r => console.log(`${r.date}  ${r.type.padEnd(8)}  amt ${r.amount.toFixed(2)}  fees:${r.feesField.toFixed(2)}  feeTx:${r.feeTxAmount.toFixed(2)}  explicit:${r.explicitLine.toFixed(2)}`));

process.exit(0);
