#!/usr/bin/env node
// judge-check — LLM judge calibration kit.
// Runs a judge prompt over real candidates AND planted decoys, then reports
// whether the judge actually discriminates or just nods. Zero dependencies.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { parseJudgeOutput } from '../lib/parse.js';
import { calibrate, verdictLine } from '../lib/calibrate.js';
import { garbageDecoys, mutants, MUTATION_KINDS } from '../lib/decoys.js';
import { makeJudge } from '../lib/api.js';
import { renderReport } from '../lib/report.js';

const USAGE = `judge-check — is your LLM judge actually discriminating, or just nodding?

Usage:
  judge-check --judge <prompt.md> --real <path> [options]

Inputs:
  --judge <file>        Judge prompt template. Must contain a {candidate} slot and
                        state the output contract (pass/fail and/or 1-10 score).
  --real <path>         Real candidates: a .jsonl file ({"id","text"} per line),
                        a directory of text files, or a single text file.
  --decoys <path>       Subtle-flaw decoys (same formats). Should all FAIL.
  --gold <path>         Known-good candidates (same formats). Should all PASS.

Decoy generation:
  --garbage <n>         Add n built-in obvious-garbage decoys (default 3).
  --mutate <n>          Add n subtle decoys mutated from real candidates (default 0).
  --mutations <kinds>   Comma-separated mutation kinds (default ${MUTATION_KINDS.join(',')}).

Run control:
  --model <id>          Judge model (default claude-sonnet-5).
  --samples <n>         Judgings per candidate, for the flip-rate metric (default 2).
  --pass-threshold <n>  Score >= n counts as pass when no explicit verdict (default 6).
  --max-tokens <n>      Max tokens per judge response (default 512).
  --dry-run <file>      Replay a recorded responses file instead of calling the API.
  --record <file>       After a live run, write responses to <file> for later --dry-run.

Output:
  --json                Emit machine-readable JSON instead of the report.
  --strict              Exit 1 unless the verdict is "your judge discriminates".
  --help                This text.

A live run reads ANTHROPIC_API_KEY from the environment. The offline demo:
  node bin/judge-check.js --judge examples/changelog-judge.md --real examples/real.jsonl \\
    --decoys examples/decoys.jsonl --gold examples/gold.jsonl --garbage 3 \\
    --dry-run examples/recorded.json
`;

function fail(msg) {
  process.stderr.write(`judge-check: ${msg}\n`);
  process.exit(2);
}

/** Load candidates from a .jsonl file, a directory of files, or a single file. */
export function loadCandidates(path, tier) {
  if (!existsSync(path)) fail(`no such path: ${path}`);
  const st = statSync(path);
  if (st.isDirectory()) {
    return readdirSync(path)
      .filter((f) => !f.startsWith('.'))
      .sort()
      .map((f) => ({
        id: basename(f, extname(f)),
        tier,
        text: readFileSync(join(path, f), 'utf8').trim(),
      }));
  }
  const raw = readFileSync(path, 'utf8');
  if (path.endsWith('.jsonl')) {
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((line, i) => {
        let obj;
        try { obj = JSON.parse(line); } catch { fail(`${path}:${i + 1} is not valid JSON`); }
        if (!obj.id || typeof obj.text !== 'string') fail(`${path}:${i + 1} needs "id" and "text"`);
        return { id: String(obj.id), tier, text: obj.text };
      });
  }
  return [{ id: basename(path, extname(path)), tier, text: raw.trim() }];
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      judge: { type: 'string' },
      real: { type: 'string' },
      decoys: { type: 'string' },
      gold: { type: 'string' },
      garbage: { type: 'string', default: '3' },
      mutate: { type: 'string', default: '0' },
      mutations: { type: 'string', default: MUTATION_KINDS.join(',') },
      model: { type: 'string', default: 'claude-sonnet-5' },
      samples: { type: 'string', default: '2' },
      'pass-threshold': { type: 'string', default: '6' },
      'max-tokens': { type: 'string', default: '512' },
      'dry-run': { type: 'string' },
      record: { type: 'string' },
      json: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (args.help) { process.stdout.write(USAGE); return; }
  if (!args.judge || !args.real) fail('--judge and --real are required (see --help)');

  const template = readFileSync(args.judge, 'utf8');
  if (!template.includes('{candidate}')) {
    fail(`judge template ${args.judge} has no {candidate} slot`);
  }

  const samples = Math.max(1, Number(args.samples) || 1);
  const passThreshold = Number(args['pass-threshold']);
  const nGarbage = Math.max(0, Number(args.garbage) || 0);
  const nMutants = Math.max(0, Number(args.mutate) || 0);

  const real = loadCandidates(args.real, 'real');
  if (!real.length) fail(`no real candidates found in ${args.real}`);
  const candidates = [
    ...real,
    ...garbageDecoys(nGarbage),
    ...(args.decoys ? loadCandidates(args.decoys, 'subtle') : []),
    ...(nMutants > 0 ? mutants(real, nMutants, args.mutations.split(',').map((k) => k.trim())) : []),
    ...(args.gold ? loadCandidates(args.gold, 'gold') : []),
  ];

  const runner = makeJudge({
    model: args.model,
    maxTokens: Number(args['max-tokens']),
    apiKey: process.env.ANTHROPIC_API_KEY,
    dryRunFile: args['dry-run'],
    recordFile: args.record,
  });

  const results = [];
  for (const cand of candidates) {
    const prompt = template.replaceAll('{candidate}', cand.text);
    const sampleResults = [];
    for (let i = 0; i < samples; i++) {
      const key = `${cand.id}#s${i}`;
      const raw = await runner.judge(key, prompt);
      sampleResults.push({ ...parseJudgeOutput(raw), raw });
    }
    results.push({ id: cand.id, tier: cand.tier, samples: sampleResults });
  }
  runner.flush();

  const metrics = calibrate(results, { passThreshold });
  const verdict = verdictLine(metrics);

  if (args.json) {
    process.stdout.write(JSON.stringify({
      model: runner.model,
      mode: runner.mode,
      verdict,
      metrics,
      candidates: results.map(({ id, tier, samples: ss }) => ({
        id, tier, samples: ss.map(({ verdict: v, score }) => ({ verdict: v, score })),
      })),
    }, null, 2) + '\n');
  } else {
    process.stdout.write(renderReport({ metrics, verdict, model: runner.model, mode: runner.mode }) + '\n');
  }

  if (args.strict && !verdict.startsWith('your judge discriminates')) process.exit(1);
}

main().catch((e) => fail(e.message));
