// calibrate.js — the calibration math. Pure functions, no I/O, no API.
//
// Input shape: an array of candidate results,
//   { id, tier: 'real'|'garbage'|'subtle'|'gold', samples: [{verdict, score}, ...] }
// where each sample is the parsed judge output for one judging of that candidate.
//
// The core idea: decoys are the unit tests of judges. A judge that passes
// candidates which are KNOWN to deserve failure is not measuring quality — it is
// nodding. Calibration quantifies that: decoy pass rate (should be ~0), gold fail
// rate (should be ~0), score separation between real and decoy sets, and verdict
// consistency across repeated samplings.

export function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1 denominator). */
export function sd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Cohen's d with pooled standard deviation:
 *   d = (mean(a) - mean(b)) / sqrt(((n1-1)*s1^2 + (n2-1)*s2^2) / (n1+n2-2))
 * Returns null when either group has < 2 samples; ±Infinity when both groups are
 * constant but their means differ (perfect separation with zero variance).
 */
export function cohensD(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const s1 = sd(a), s2 = sd(b);
  const pooled = Math.sqrt(
    ((a.length - 1) * s1 ** 2 + (b.length - 1) * s2 ** 2) / (a.length + b.length - 2)
  );
  const diff = mean(a) - mean(b);
  if (pooled === 0) return diff === 0 ? 0 : (diff > 0 ? Infinity : -Infinity);
  return diff / pooled;
}

/**
 * Resolve a sample to a pass/fail verdict. An explicit verdict wins; otherwise a
 * numeric score is thresholded (score >= passThreshold → pass). Null if neither.
 */
export function resolveVerdict(sample, passThreshold) {
  if (sample.verdict === 'pass' || sample.verdict === 'fail') return sample.verdict;
  if (typeof sample.score === 'number' && Number.isFinite(sample.score)) {
    return sample.score >= passThreshold ? 'pass' : 'fail';
  }
  return null;
}

const TIERS = ['real', 'garbage', 'subtle', 'gold'];

/**
 * Compute all calibration metrics.
 * @param {Array} candidates  [{id, tier, samples: [{verdict, score}]}]
 * @param {{passThreshold?: number}} opts
 */
export function calibrate(candidates, { passThreshold = 6 } = {}) {
  const tiers = {};
  for (const t of TIERS) tiers[t] = { candidates: 0, passed: 0, failed: 0, judged: 0 };

  const scoresByTier = { real: [], garbage: [], subtle: [], gold: [] };
  const flips = { flipped: 0, comparable: 0, flippedIds: [] };
  const unparsed = { count: 0, total: 0 };
  const notable = { decoysPassed: [], goldFailed: [] };

  for (const cand of candidates) {
    const tier = tiers[cand.tier];
    if (!tier) throw new Error(`unknown tier "${cand.tier}" on candidate "${cand.id}"`);
    tier.candidates += 1;

    const verdicts = [];
    for (const sample of cand.samples) {
      unparsed.total += 1;
      const v = resolveVerdict(sample, passThreshold);
      if (v === null) { unparsed.count += 1; continue; }
      verdicts.push(v);
      tier.judged += 1;
      if (v === 'pass') tier.passed += 1; else tier.failed += 1;
      if (typeof sample.score === 'number' && Number.isFinite(sample.score)) {
        scoresByTier[cand.tier].push(sample.score);
      }
    }

    if (verdicts.length >= 2) {
      flips.comparable += 1;
      if (new Set(verdicts).size > 1) { flips.flipped += 1; flips.flippedIds.push(cand.id); }
    }

    const passedAny = verdicts.includes('pass');
    if ((cand.tier === 'garbage' || cand.tier === 'subtle') && passedAny) {
      notable.decoysPassed.push({ id: cand.id, tier: cand.tier });
    }
    if (cand.tier === 'gold' && verdicts.includes('fail')) notable.goldFailed.push(cand.id);
  }

  for (const t of TIERS) {
    const tier = tiers[t];
    tier.passRate = tier.judged ? tier.passed / tier.judged : null;
    tier.failRate = tier.judged ? tier.failed / tier.judged : null;
  }

  const decoy = {
    passed: tiers.garbage.passed + tiers.subtle.passed,
    judged: tiers.garbage.judged + tiers.subtle.judged,
  };
  decoy.passRate = decoy.judged ? decoy.passed / decoy.judged : null;

  const realScores = scoresByTier.real;
  const decoyScores = [...scoresByTier.garbage, ...scoresByTier.subtle];
  const scores = {
    realMean: mean(realScores),
    decoyMean: mean(decoyScores),
    delta: realScores.length && decoyScores.length ? mean(realScores) - mean(decoyScores) : null,
    cohensD: cohensD(realScores, decoyScores),
    realN: realScores.length,
    decoyN: decoyScores.length,
  };

  flips.rate = flips.comparable ? flips.flipped / flips.comparable : null;

  return {
    counts: {
      candidates: candidates.length,
      samples: unparsed.total,
      real: tiers.real.candidates,
      garbage: tiers.garbage.candidates,
      subtle: tiers.subtle.candidates,
      gold: tiers.gold.candidates,
    },
    tiers,
    decoy,
    scores,
    flips,
    unparsed,
    notable,
    passThreshold,
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * The honest one-liner. Checks the worst failure modes first: passing garbage,
 * passing subtle decoys, failing gold, flipping across samplings.
 */
export function verdictLine(m) {
  if (m.decoy.judged === 0) {
    return 'no decoys judged — calibration impossible. A judge tested only on real candidates proves nothing.';
  }
  const g = m.tiers.garbage, s = m.tiers.subtle;
  if (g.judged > 0 && g.passed > 0) {
    return `your judge is nodding — it passed obvious garbage (${g.passed}/${g.judged} garbage judgments).`;
  }
  if (s.judged > 0 && s.passRate >= 0.5) {
    return `your judge is nodding — ${pct(s.passRate)} of subtle-decoy judgments pass.`;
  }
  if (s.judged > 0 && s.passed > 0) {
    return `your judge leaks — ${pct(s.passRate)} of subtle-decoy judgments pass. Tighten the rubric against those failure modes.`;
  }
  if (m.tiers.gold.judged > 0 && m.tiers.gold.failRate > 0.25) {
    return `your judge is over-strict — it fails known-good candidates (${pct(m.tiers.gold.failRate)} of gold judgments).`;
  }
  if (m.flips.comparable > 0 && m.flips.rate > 0.25) {
    return `your judge is inconsistent — ${pct(m.flips.rate)} of candidates flip verdicts across samplings.`;
  }
  let line = 'your judge discriminates — decoys fail, gold passes.';
  if (m.decoy.judged < 6) line += ' (small decoy set — low confidence)';
  return line;
}
