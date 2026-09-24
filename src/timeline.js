// BS 7858 continuous-history analysis: month-by-month coverage of the screening period.
const { screening } = require('./config');

const toIdx = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
const fromIdx = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };

function historyGaps(history, now = new Date()) {
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const startIdx = nowIdx - screening.periodYears * 12;
  const covered = new Set();
  const errors = [];
  const valid = /^\d{4}-\d{2}$/;
  for (const h of history) {
    if (!h || !valid.test(h.from || '')) continue;
    const a = toIdx(h.from);
    const b = h.current === 'yes' ? nowIdx : (valid.test(h.to || '') ? toIdx(h.to) : null);
    if (b === null) continue;
    if (b < a) { errors.push(`A period starting ${fmtMonth(h.from)} ends before it starts.`); continue; }
    if (a > nowIdx) errors.push(`A period starts in the future (${fmtMonth(h.from)}).`);
    for (let i = a; i <= Math.min(b, nowIdx); i++) covered.add(i);
  }
  const gaps = [];
  let run = null;
  // The current month is still in progress, so only require coverage up to last month
  // unless something is marked current.
  for (let i = startIdx; i <= nowIdx - 1; i++) {
    if (!covered.has(i)) { if (!run) run = { from: i, to: i }; else run.to = i; }
    else if (run) { gaps.push(run); run = null; }
  }
  if (run) gaps.push(run);
  const out = gaps.map((g) => ({ from: fromIdx(g.from), to: fromIdx(g.to), months: g.to - g.from + 1 }));
  for (const g of out) {
    errors.push(`No activity recorded for ${fmtMonth(g.from)}${g.months > 1 ? ` – ${fmtMonth(g.to)}` : ''}. Please add the period (e.g. unemployment or career break) so your ${screening.periodYears}-year history is continuous.`);
  }
  const totalMonths = nowIdx - startIdx;
  const coveredInWindow = [...covered].filter((i) => i >= startIdx && i < nowIdx).length;
  return { gaps: out, errors, coveragePct: Math.round((coveredInWindow / totalMonths) * 100), windowStart: fromIdx(startIdx) };
}

module.exports = { historyGaps, fmtMonth };
