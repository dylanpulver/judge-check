// decoys.js — decoy generation.
//
// Three tiers of decoys (see docs/decoy-design.md):
//   garbage — obvious junk; any judge worth running must fail all of it.
//   subtle  — plausible-looking candidates with a planted flaw. Supply your own
//             (best) or derive them from real candidates with mutate()/mutants().
//   gold    — known-good candidates (always user-supplied; there is no way to
//             synthesize "known good").

/** Built-in obvious-garbage texts, cycled by garbageDecoys(). */
export const GARBAGE = [
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua',
  'asdf qwer zxcv uiop hjkl vbnm 0000 ~~~~ ((( ]]] ??? !!! plok mnbv',
  'the the the the the the the the the the the the the the the the the the',
  'Bananas are an excellent source of potassium and make a convenient snack for long hiking trips.',
];

/** Generate n obvious-garbage decoy candidates (deterministic). */
export function garbageDecoys(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `garbage-${i + 1}`, tier: 'garbage', text: GARBAGE[i % GARBAGE.length] });
  }
  return out;
}

// Verb flips for the `negate` mutation. First match wins.
const NEGATIONS = [
  [/\bfixed\b/i, 'failed to fix'],
  [/\bfixes\b/i, 'does not fix'],
  [/\badded\b/i, 'removed'],
  [/\badds\b/i, 'removes'],
  [/\bimproved\b/i, 'degraded'],
  [/\bimproves\b/i, 'degrades'],
  [/\bincreased\b/i, 'decreased'],
  [/\bincreases\b/i, 'decreases'],
  [/\bfaster\b/i, 'slower'],
  [/\benabled\b/i, 'disabled'],
  [/\bsupports\b/i, 'no longer supports'],
  [/\bprevents\b/i, 'causes'],
  [/\bresolves\b/i, 'reintroduces'],
  [/\bnow\b/i, 'no longer'],
];

export const MUTATION_KINDS = ['negate', 'drop-evidence', 'vague'];

function matchCase(replacement, matched) {
  if (/^[A-Z]/.test(matched)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * Deterministically mutate a real candidate's text into a subtle decoy.
 *
 *   negate        — flip the first recognized claim verb ("fixed" → "failed to
 *                   fix"). Targets factual-accuracy judges. Falls back to an
 *                   explicit contradiction prefix when no verb matches.
 *   drop-evidence — keep only the first sentence, discarding the supporting
 *                   detail. Targets evidence-required judges.
 *   vague         — strip specifics: code spans become "something", numbers
 *                   become "some". Targets specificity/concreteness judges.
 *
 * Pick kinds that attack YOUR judge's pass criteria — a mutation orthogonal to
 * what the judge checks produces a decoy that legitimately passes. See
 * docs/decoy-design.md.
 */
export function mutate(text, kind) {
  switch (kind) {
    case 'negate': {
      for (const [re, replacement] of NEGATIONS) {
        const m = text.match(re);
        if (m) return text.replace(re, matchCase(replacement, m[0]));
      }
      return `It is not the case that ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    }
    case 'drop-evidence': {
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length > 1) return sentences[0];
      const words = text.split(/\s+/);
      return `${words.slice(0, Math.ceil(words.length / 2)).join(' ')}.`;
    }
    case 'vague': {
      return text
        .replace(/`[^`]*`/g, 'something')
        .replace(/\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds|minutes|hours|%|x)\b/gi, 'a bit')
        .replace(/\d[\d,]*(?:\.\d+)?/g, 'some');
    }
    default:
      throw new Error(`unknown mutation kind "${kind}" (known: ${MUTATION_KINDS.join(', ')})`);
  }
}

/**
 * Build n subtle-decoy candidates by mutating real ones. Deterministic: cycles
 * through the real candidates and the given mutation kinds in order.
 */
export function mutants(reals, n, kinds = MUTATION_KINDS) {
  if (!reals.length) throw new Error('cannot mutate: no real candidates supplied');
  if (!kinds.length) throw new Error('cannot mutate: no mutation kinds supplied');
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = reals[i % reals.length];
    const kind = kinds[i % kinds.length];
    out.push({
      id: `mutant-${kind}-${base.id}`,
      tier: 'subtle',
      text: mutate(base.text, kind),
    });
  }
  return out;
}
