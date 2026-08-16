// report.js — pretty terminal output. Colors only on a TTY (and never with
// NO_COLOR set), so piped/captured output is plain text.

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const red = paint('31');
const yellow = paint('33');

const pct = (x) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
const num = (x, d = 1) =>
  x === null ? 'n/a' : x === Infinity ? 'inf' : x === -Infinity ? '-inf' : x.toFixed(d);

function rateLine(label, passed, judged, rate, { wantZero }) {
  const frac = `${passed}/${judged}`;
  const shown = judged === 0 ? dim('none judged') : `${frac}  (${pct(rate)})`;
  const flag =
    judged === 0 ? '' :
    (wantZero ? (passed === 0 ? green('ok') : red('LEAK')) : (passed === 0 ? green('ok') : red('FAIL')));
  return `  ${label.padEnd(22)}${shown.padEnd(18)}${dim('should be ~0')}  ${flag}`;
}

/** Render the calibration report to a string. */
export function renderReport({ metrics: m, verdict, model, mode }) {
  const lines = [];
  const c = m.counts;
  lines.push(bold('judge-check — calibration report'));
  lines.push(`  judge model: ${model}${mode === 'dry-run' ? dim(' (dry-run replay)') : ''}`);
  const perCand = c.candidates && c.samples % c.candidates === 0 ? c.samples / c.candidates : null;
  lines.push(
    `  candidates: ${c.real} real · ${c.garbage} garbage · ${c.subtle} subtle · ${c.gold} gold` +
    dim(perCand
      ? `   (${c.candidates} candidates × ${perCand} samples = ${c.samples} judgments)`
      : `   (${c.samples} judgments)`)
  );
  lines.push('');
  lines.push(bold('  decoy pass rate') + dim('  (decoys should always fail)'));
  lines.push(rateLine('  garbage', m.tiers.garbage.passed, m.tiers.garbage.judged, m.tiers.garbage.passRate, { wantZero: true }));
  lines.push(rateLine('  subtle', m.tiers.subtle.passed, m.tiers.subtle.judged, m.tiers.subtle.passRate, { wantZero: true }));
  lines.push(bold('  gold fail rate') + dim('   (known-good should always pass)'));
  lines.push(rateLine('  gold', m.tiers.gold.failed, m.tiers.gold.judged, m.tiers.gold.failRate, { wantZero: true }));
  lines.push('');
  const s = m.scores;
  lines.push(
    `  score separation     real ${num(s.realMean)} vs decoy ${num(s.decoyMean)}   ` +
    `Δ ${num(s.delta)}   Cohen's d ${num(s.cohensD, 2)}`
  );
  lines.push(
    `  verdict flips        ${m.flips.flipped}/${m.flips.comparable} candidates (${pct(m.flips.rate)}) across repeated samplings`
  );
  lines.push(`  unparsed responses   ${m.unparsed.count}/${m.unparsed.total}`);

  const nb = m.notable;
  if (nb.decoysPassed.length || nb.goldFailed.length || m.flips.flippedIds.length) {
    lines.push('');
    lines.push(bold('  worth a look'));
    for (const d of nb.decoysPassed) lines.push(`    ${red('decoy passed')}   ${d.id} (${d.tier})`);
    for (const id of nb.goldFailed) lines.push(`    ${red('gold failed')}    ${id}`);
    for (const id of m.flips.flippedIds) lines.push(`    ${yellow('verdict flip')}   ${id}`);
  }

  lines.push('');
  const good = verdict.startsWith('your judge discriminates');
  lines.push(`  ${bold('VERDICT:')} ${(good ? green : red)(verdict)}`);
  return lines.join('\n');
}
