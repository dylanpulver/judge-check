import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJudgeOutput } from '../lib/parse.js';

test('parses the canonical one-line JSON contract', () => {
  const r = parseJudgeOutput('{"verdict": "pass", "score": 8, "reason": "solid"}');
  assert.deepEqual({ verdict: r.verdict, score: r.score }, { verdict: 'pass', score: 8 });
});

test('parses JSON embedded in prose', () => {
  const r = parseJudgeOutput('Here is my assessment:\n{"verdict": "fail", "score": 2}\nThanks!');
  assert.equal(r.verdict, 'fail');
  assert.equal(r.score, 2);
});

test('accepts alternate JSON field names and boolean pass', () => {
  assert.equal(parseJudgeOutput('{"result": "PASS"}').verdict, 'pass');
  assert.equal(parseJudgeOutput('{"decision": "no"}').verdict, 'fail');
  assert.equal(parseJudgeOutput('{"pass": true, "rating": 7}').verdict, 'pass');
  assert.equal(parseJudgeOutput('{"pass": true, "rating": 7}').score, 7);
  assert.equal(parseJudgeOutput('{"verdict": "pass", "score": "9"}').score, 9);
});

test('clamps scores into 1-10', () => {
  assert.equal(parseJudgeOutput('{"verdict": "pass", "score": 15}').score, 10);
  assert.equal(parseJudgeOutput('{"verdict": "fail", "score": 0}').score, 1);
});

test('falls back to "N/10" and "score:" prose forms', () => {
  assert.equal(parseJudgeOutput('I would give this a 7/10 overall.').score, 7);
  assert.equal(parseJudgeOutput('Score: 4. The claim lacks evidence.').score, 4);
});

test('falls back to verdict words in prose', () => {
  assert.equal(parseJudgeOutput('VERDICT: FAIL — no evidence provided').verdict, 'fail');
  assert.equal(parseJudgeOutput('This entry passes the bar.').verdict, 'pass');
  assert.equal(parseJudgeOutput('PASS').verdict, 'pass');
});

test('labeled verdict beats an earlier bare verdict word', () => {
  const r = parseJudgeOutput('It could pass at a stretch, but verdict: fail.');
  assert.equal(r.verdict, 'fail');
});

test('unparseable output returns nulls, never throws', () => {
  assert.deepEqual(parseJudgeOutput('I cannot help with that.'), { verdict: null, score: null });
  assert.deepEqual(parseJudgeOutput(''), { verdict: null, score: null });
  assert.deepEqual(parseJudgeOutput(null), { verdict: null, score: null });
  assert.deepEqual(parseJudgeOutput('{"broken": '), { verdict: null, score: null });
});
