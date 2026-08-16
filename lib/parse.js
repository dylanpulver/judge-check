// parse.js — turn a judge's raw text response into a normalized {verdict, score}.
//
// The judge contract (stated in your judge prompt) should ask for a one-line JSON
// object like {"verdict": "pass", "score": 8}. Models mostly comply; this parser
// tolerates the ways they don't: prose around the JSON, "7/10", "Score: 8",
// "VERDICT: FAIL", bare "PASS". Anything unparseable comes back as nulls and is
// counted (and reported) as an unparsed response — never silently coerced.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function fromObject(obj) {
  const out = { verdict: null, score: null };
  if (obj === null || typeof obj !== 'object') return out;

  const v = obj.verdict ?? obj.result ?? obj.decision ?? obj.judgement ?? obj.judgment;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'pass' || s === 'fail') out.verdict = s;
    else if (s === 'yes' || s === 'true') out.verdict = 'pass';
    else if (s === 'no' || s === 'false') out.verdict = 'fail';
  }
  if (typeof obj.pass === 'boolean') out.verdict = obj.pass ? 'pass' : 'fail';

  const sc = obj.score ?? obj.rating;
  if (typeof sc === 'number' && Number.isFinite(sc)) out.score = clamp(sc, 1, 10);
  else if (typeof sc === 'string' && /^\d+(\.\d+)?$/.test(sc.trim())) {
    out.score = clamp(Number(sc), 1, 10);
  }
  return out;
}

/**
 * Parse a judge response.
 * @param {string} text raw model output
 * @returns {{verdict: 'pass'|'fail'|null, score: number|null}}
 */
export function parseJudgeOutput(text) {
  const empty = { verdict: null, score: null };
  if (typeof text !== 'string' || !text.trim()) return empty;

  // 1. JSON: try the whole text, then the widest {...} span, then any JSON-looking line.
  const spans = [text.trim()];
  const wide = text.match(/\{[\s\S]*\}/);
  if (wide) spans.push(wide[0]);
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}')) spans.push(t);
  }
  for (const span of spans) {
    let obj;
    try { obj = JSON.parse(span); } catch { continue; }
    const parsed = fromObject(obj);
    if (parsed.verdict !== null || parsed.score !== null) return parsed;
  }

  // 2. Regex fallbacks over prose.
  const out = { verdict: null, score: null };

  const outOfTen = text.match(/\b(\d{1,2}(?:\.\d+)?)\s*\/\s*10\b/);
  const labeled = text.match(/\b(?:score|rating)\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)\b/i);
  const scoreStr = outOfTen?.[1] ?? labeled?.[1];
  if (scoreStr !== undefined) out.score = clamp(Number(scoreStr), 1, 10);

  const labeledVerdict = text.match(/\bverdict\s*[:=]?\s*(pass|fail)\b/i);
  const bareVerdict = text.match(/\b(pass|fail)(?:ed|es|s)?\b/i);
  const verdictStr = labeledVerdict?.[1] ?? bareVerdict?.[1];
  if (verdictStr !== undefined) out.verdict = verdictStr.toLowerCase();

  return out;
}
