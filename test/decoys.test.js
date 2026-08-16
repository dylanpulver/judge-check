import test from 'node:test';
import assert from 'node:assert/strict';
import { garbageDecoys, mutate, mutants, GARBAGE, MUTATION_KINDS } from '../lib/decoys.js';

test('garbageDecoys: deterministic ids and cycling texts', () => {
  const g = garbageDecoys(6);
  assert.equal(g.length, 6);
  assert.equal(g[0].id, 'garbage-1');
  assert.equal(g[5].id, 'garbage-6');
  assert.ok(g.every((d) => d.tier === 'garbage'));
  assert.equal(g[4].text, GARBAGE[0]); // cycles past the built-in list
  assert.deepEqual(garbageDecoys(3), garbageDecoys(3)); // deterministic
});

test('negate: flips the first recognized claim verb, preserving case', () => {
  assert.equal(
    mutate('Fixed a crash on startup. Users no longer lose work.', 'negate'),
    'Failed to fix a crash on startup. Users no longer lose work.'
  );
  assert.equal(mutate('This adds retry logic.', 'negate'), 'This removes retry logic.');
});

test('negate: falls back to an explicit contradiction prefix', () => {
  const out = mutate('The report cites three sources.', 'negate');
  assert.ok(out.startsWith('It is not the case that the report cites'));
});

test('drop-evidence: keeps only the first sentence', () => {
  assert.equal(
    mutate('We fixed the bug. Here is the stack trace and the failing test.', 'drop-evidence'),
    'We fixed the bug.'
  );
});

test('drop-evidence: halves a single-sentence candidate', () => {
  const out = mutate('one two three four five six', 'drop-evidence');
  assert.equal(out, 'one two three.');
});

test('vague: strips code spans, measurements, and numbers', () => {
  const out = mutate('Search in `lark find` now takes 200ms for 10,000 files.', 'vague');
  assert.ok(!/\d/.test(out), `expected no digits, got: ${out}`);
  assert.ok(out.includes('something'));
  assert.ok(out.includes('a bit'));
});

test('mutate: unknown kind throws', () => {
  assert.throws(() => mutate('x', 'reverse'), /unknown mutation kind/);
});

test('mutants: cycles reals and kinds, tags tier subtle, deterministic ids', () => {
  const reals = [
    { id: 'r1', text: 'Fixed the login bug. Sessions persist now.' },
    { id: 'r2', text: 'Improved cold-start time to 120ms.' },
  ];
  const out = mutants(reals, 3, ['negate', 'drop-evidence']);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.id), [
    'mutant-negate-r1',
    'mutant-drop-evidence-r2',
    'mutant-negate-r1', // reals and kinds both cycle
  ]);
  assert.ok(out.every((m) => m.tier === 'subtle'));
  assert.equal(out[0].text, out[2].text);
});

test('mutants: default kinds are the documented set; empty inputs throw', () => {
  assert.deepEqual(MUTATION_KINDS, ['negate', 'drop-evidence', 'vague']);
  assert.throws(() => mutants([], 1), /no real candidates/);
  assert.throws(() => mutants([{ id: 'r', text: 'x' }], 1, []), /no mutation kinds/);
});
