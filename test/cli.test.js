// End-to-end smoke test of the CLI in --dry-run mode. No network, no API key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = [
  join(root, 'bin/judge-check.js'),
  '--judge', join(root, 'examples/changelog-judge.md'),
  '--real', join(root, 'examples/real.jsonl'),
  '--decoys', join(root, 'examples/decoys.jsonl'),
  '--gold', join(root, 'examples/gold.jsonl'),
  '--garbage', '3',
  '--dry-run', join(root, 'examples/recorded.json'),
];

const env = { ...process.env, ANTHROPIC_API_KEY: '' }; // prove no key is needed

test('offline demo runs end-to-end and reports the planted leak', () => {
  const out = execFileSync('node', args, { encoding: 'utf8', env });
  assert.match(out, /calibration report/);
  assert.match(out, /VERDICT: your judge leaks/);
  assert.match(out, /decoy-internal-dressed-up/);
  assert.match(out, /verdict flip\s+real-7/);
});

test('--json emits machine-readable metrics', () => {
  const out = execFileSync('node', [...args, '--json'], { encoding: 'utf8', env });
  const data = JSON.parse(out);
  assert.equal(data.mode, 'dry-run');
  assert.equal(data.metrics.counts.candidates, 17);
  assert.equal(data.metrics.counts.samples, 34);
  assert.equal(data.metrics.tiers.subtle.passed, 2);
  assert.equal(data.metrics.tiers.garbage.passed, 0);
  assert.equal(data.metrics.tiers.gold.failed, 0);
  assert.match(data.verdict, /leaks/);
});

test('--strict exits 1 when the judge is not clean', () => {
  assert.throws(
    () => execFileSync('node', [...args, '--strict'], { encoding: 'utf8', env, stdio: 'pipe' }),
    (e) => e.status === 1
  );
});
