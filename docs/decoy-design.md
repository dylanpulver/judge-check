# Decoy design

Decoy design is the hard part of judge calibration. judge-check automates the
running and the math; the quality of the signal is decided by the decoys you
feed it. This page is the practical guidance.

## The three tiers, and what each one proves

| Tier | Should | What passing it proves |
|---|---|---|
| **garbage** | always fail | The judge reads the candidate at all. A judge that passes keyboard mash or off-topic text is not evaluating — it is emitting "pass" on anything shaped like input. This is a smoke test, not calibration. |
| **subtle** | always fail | The judge enforces its actual criteria. Each subtle decoy plants exactly one flaw the rubric is supposed to catch. This tier is where calibration lives. |
| **gold** | always pass | The judge is not just a rejection machine. A judge you tightened until every decoy fails can silently become one that fails everything; gold candidates catch that overcorrection. |

You need all three. Garbage-only calibration is trivially gameable (any judge
with a pulse fails garbage). Decoys without gold rewards paranoia. Gold without
decoys rewards nodding.

## Rule 1: a decoy must attack the judge's pass criteria

A subtle decoy is a candidate that *should* fail **according to this judge's
rubric**. Not "a worse candidate" — a candidate with a planted violation of the
specific thing the judge claims to check.

Work backwards from the rubric. For each pass criterion, write a candidate
that looks right on every other axis and violates only that one:

- Judge checks **factual accuracy** → take a real candidate and negate its key
  claim.
- Judge checks **evidence is cited** → take a real candidate and delete the
  evidence section, keeping the confident conclusion.
- Judge checks **specificity** → keep the shape and tone, remove every concrete
  detail ("dramatically improved the experience").
- Judge checks **the work was done** → describe the work in future tense, or as
  intent ("we plan to...").

A decoy orthogonal to the rubric is a false alarm generator: it may
legitimately pass, and you will "fix" a judge that was fine.

## Rule 2: match the mutation to the axis

`--mutate` derives subtle decoys mechanically from your real candidates. The
built-in kinds each target one axis:

| Kind | What it does | Right for judges that check |
|---|---|---|
| `negate` | flips the first claim verb ("fixed" → "failed to fix") | factual accuracy, claim correctness |
| `drop-evidence` | keeps only the first sentence | evidence, justification, completeness |
| `vague` | strips code spans, numbers, measurements | specificity, concreteness |

Pick with `--mutations negate` (etc.) rather than accepting all three blindly.
Example of the failure mode: for a judge that asks "does this changelog entry
state a user-visible change?", a `negate` mutant of "Added a --watch flag"
becomes "Removed a --watch flag" — which is *still a user-visible change* and
deserves to pass. The mutation was orthogonal to the axis. That judge needs
hand-written decoys (puffery, internal work dressed up as user-facing), which
is exactly what the shipped example uses.

Hand-written decoys beat mutants whenever you can afford them. Mutants are for
scale and for axes that are mechanically flippable.

## Rule 3: decoys must be stylistically indistinguishable

If your real candidates are two paragraphs of fluent prose and your decoys are
one clumsy sentence, the judge can separate them by *style* and your
calibration numbers will look great while measuring nothing. Write decoys at
the same length, register, and polish as the real set. The ideal subtle decoy
is one a hurried human reviewer would wave through.

## Rule 4: enough of them, refreshed occasionally

- **Counts:** aim for decoys ≳ half the size of the real set, spread across the
  failure modes you care about. judge-check flags fewer than 6 decoy judgments
  as low-confidence — one decoy passing or failing shouldn't swing your
  conclusion.
- **Per-mode coverage:** one decoy per failure mode tells you *whether* that
  mode leaks; two or three tell you whether it leaks *reliably*.
- **Refresh when the judge changes:** every time you edit the judge prompt to
  fix a leak, you have selected against your current decoy set. Add new decoys
  for new failure modes; don't just re-run the old set until it's green —
  that's overfitting your judge to your decoys.

## Rule 5: read the failures, not just the rates

When a decoy passes, read the judge's stated reason (it's in the recorded
responses). The reason tells you *which* rubric clause the judge is bending —
usually it has invented a charitable interpretation ("a new caching
architecture suggests a performance benefit"). The fix is a rubric edit that
names that exact move as a fail, not a generic "be stricter" instruction —
generic strictness is how you start failing gold.

## Anti-patterns

- **Decoys the judge has seen.** If the decoy text appears in the judge prompt
  as a "bad example", failing it proves string matching, not judgment.
- **Labeling the decoy.** Never tell the judge which candidate is the control —
  a sycophantic judge will obey the label and sail through. (The batch is
  shuffled, unlabeled scoring for exactly this reason.)
- **Only easy decoys.** A garbage-only decoy set converges to 0% pass rate on
  any judge and tells you nothing about the marginal cases where judges
  actually earn their keep.
- **Treating calibration as correctness.** A judge that fails every decoy and
  passes every gold can still be wrong about real candidates in ways your
  decoys don't cover. Calibration bounds the failure modes you thought to
  plant — nothing more. See the "Honest limits" section of the README.
