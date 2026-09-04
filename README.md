# judge-check

[![CI](https://github.com/dylanpulver/judge-check/actions/workflows/ci.yml/badge.svg)](https://github.com/dylanpulver/judge-check/actions/workflows/ci.yml)

**Is your LLM judge actually discriminating, or just nodding?**

Decoys are the unit tests of judges. If you use an LLM to grade outputs — pass/fail
gates in a pipeline, 1–10 scores in an eval harness — you have a measurement
instrument, and an uncalibrated instrument is worse than none: it returns numbers
that look like signal. The only cheap, direct test is to plant candidates that are
*known* to deserve failure and see whether the judge fails them. A judge that never
fails a decoy is measuring nothing; its "pass" on your real candidates is the same
nod it gives everything. judge-check runs your judge over your real candidates plus
three tiers of planted controls — obvious garbage, subtle-flaw decoys, and known-good
gold — and reports whether the judge separates them, with an honest one-line verdict.

Zero npm dependencies. Node 18+. Anthropic API via `fetch` (no SDK), or fully
offline with a recorded responses file.

## Quickstart (offline — no API key)

```sh
git clone <this repo> && cd judge-check
npm run example
# equivalently:
node bin/judge-check.js \
  --judge examples/changelog-judge.md \
  --real examples/real.jsonl \
  --decoys examples/decoys.jsonl \
  --gold examples/gold.jsonl \
  --garbage 3 \
  --dry-run examples/recorded.json
```

The shipped example is a small judge ("does this changelog entry state a concrete,
user-visible change?") run over 8 real entries, 3 garbage decoys, 4 subtle decoys,
and 2 gold entries, replaying recorded responses. Output, verbatim:

```
judge-check — calibration report
  judge model: claude-sonnet-5 (dry-run replay)
  candidates: 8 real · 3 garbage · 4 subtle · 2 gold   (17 candidates × 2 samples = 34 judgments)

  decoy pass rate  (decoys should always fail)
    garbage             0/6  (0%)         should be ~0  ok
    subtle              2/8  (25%)        should be ~0  LEAK
  gold fail rate   (known-good should always pass)
    gold                0/4  (0%)         should be ~0  ok

  score separation     real 6.1 vs decoy 2.2   Δ 3.9   Cohen's d 1.47
  verdict flips        1/17 candidates (6%) across repeated samplings
  unparsed responses   0/34

  worth a look
    decoy passed   decoy-internal-dressed-up (subtle)
    verdict flip   real-7

  VERDICT: your judge leaks — 25% of subtle-decoy judgments pass. Tighten the rubric against those failure modes.
```

The example judge is deliberately imperfect: it credits "adopted a new internal
caching architecture" as a user-visible change (a decoy that dresses internal work
up as user-facing), and it flips on a borderline refactor entry. That is the point —
the report tells you *which* rubric clause is bending, so the fix is a targeted
rubric edit, not vibes.

## Real run

```sh
export ANTHROPIC_API_KEY=sk-ant-...

node bin/judge-check.js \
  --judge my-judge.md \
  --real my-candidates.jsonl \
  --decoys my-decoys.jsonl \
  --gold my-gold.jsonl \
  --garbage 3 --mutate 4 --mutations negate,drop-evidence \
  --model claude-sonnet-5 \
  --samples 2 \
  --record recorded.json
```

- **Judge definition** (`--judge`): any prompt file with a `{candidate}` slot. It
  should state the output contract — ideally one line of JSON like
  `{"verdict": "pass", "score": 7, "reason": "..."}`. The parser also tolerates
  `7/10`, `Score: 7`, and bare `PASS`/`FAIL`; anything unparseable is counted and
  reported as unparsed, never coerced.
- **Candidates** (`--real`, `--decoys`, `--gold`): a `.jsonl` file
  (`{"id": "...", "text": "..."}` per line), a directory of text files (filename =
  id), or a single text file.
- **Decoys**: `--garbage n` adds built-in obvious junk; `--decoys` supplies your
  hand-written subtle decoys (best); `--mutate n` derives subtle decoys from real
  candidates mechanically (`negate`, `drop-evidence`, `vague` — pick kinds that
  attack *your* judge's criteria, see [docs/decoy-design.md](docs/decoy-design.md)).
- **`--record file.json`** captures a live run's responses so it can be replayed
  later with `--dry-run file.json` — deterministic CI checks, no key, no cost.
- **`--json`** emits the full metrics as JSON; **`--strict`** exits 1 unless the
  verdict is "your judge discriminates" (for CI gates). `--help` lists everything.

## Metrics

Let a *judgment* be one sampling of the judge on one candidate. A judgment's
verdict is the judge's explicit pass/fail if it gave one; otherwise its score is
thresholded (`score >= --pass-threshold`, default 6, → pass).

| Metric | Formula | Reading |
|---|---|---|
| **decoy pass rate** | passed decoy judgments / decoy judgments, per tier (garbage, subtle) and combined | Should be ~0. Any garbage pass means the judge isn't reading. Subtle passes name the rubric clauses that bend. |
| **gold fail rate** | failed gold judgments / gold judgments | Should be ~0. High means the judge is a rejection machine, or your rubric drifted stricter than intended. |
| **score separation** | `mean(real scores) − mean(decoy scores)`, plus Cohen's d: `d = (m₁ − m₂) / sp` with pooled sd `sp = √(((n₁−1)s₁² + (n₂−1)s₂²) / (n₁+n₂−2))` | How far apart the score distributions sit. d ≳ 0.8 is conventionally "large"; a discriminating judge on well-built decoys should be well past that. Reported as `inf` when both groups are constant but separated. |
| **verdict flip rate** | candidates whose resolved verdicts disagree across samplings / candidates with ≥ 2 resolved samplings (default `--samples 2`) | Consistency. A judge that flips on re-ask is adding coin-flip noise to your pipeline regardless of its calibration. |
| **unparsed rate** | judgments where neither a verdict nor a score could be parsed / all judgments | Contract compliance. High values mean your output contract is being ignored — fix the judge prompt before trusting anything else. |

**The verdict line** checks the failure modes worst-first: passed garbage → *nodding*;
≥50% of subtle decoys pass → *nodding*; any subtle decoy passes → *leaks*; >25% of
gold fails → *over-strict*; >25% of candidates flip → *inconsistent*; otherwise
*your judge discriminates* (with a low-confidence caveat under 6 decoy judgments).

## Honest limits

- **Calibration ≠ correctness.** Passing decoys and failing gold bounds the failure
  modes you thought to plant. A perfectly calibrated judge can still be wrong about
  real candidates in ways your decoys don't cover, and its scores can still encode
  biases (length, style, position) you didn't test for.
- **Decoy design is the hard part** — this tool automates the running and the math,
  not the thinking. A decoy orthogonal to your judge's criteria legitimately passes
  and teaches you nothing; a decoy stylistically distinguishable from your real set
  lets the judge cheat on style. See [docs/decoy-design.md](docs/decoy-design.md).
- **Iterating a judge against a fixed decoy set overfits to that set.** Refresh
  decoys when you edit the rubric.
- **Two samplings is a floor, not a study.** The flip rate at `--samples 2` detects
  gross inconsistency cheaply; it is not a variance estimate.
- **Small sets, wide error bars.** The example's 25% subtle pass rate is 2 of 8
  judgments. Treat rates on small sets as leads to investigate, not measurements.

## Siblings

- **research-factory** — the research-brief pipeline where this mechanism was
  battle-tested: every automated judging batch there includes a fabricated control
  brief, and a judge that scores the control a "hit" has its whole batch discarded
  as flattery. judge-check is that idea extracted into a standalone tool.
- **claude-skills** — skill library for agent workflows, maintained with the same
  test-the-instrument philosophy.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Dylan Pulver](https://dylanpulver.com), software engineer and entrepreneur in Toronto.
