// api.js — the only file that talks to the network. Anthropic Messages API via
// fetch, zero SDK dependencies. Also implements --dry-run (replay a recorded
// responses file, so the demo runs offline) and --record (capture responses to
// create such a file).

import { readFileSync, writeFileSync } from 'node:fs';

const API_URL = 'https://api.anthropic.com/v1/messages';

/** One live judging call. Returns the response's concatenated text blocks. */
export async function callAnthropic({ model, prompt, maxTokens, apiKey }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') return ''; // counted as unparsed downstream
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Build the judge function used by the CLI: (key, prompt) -> response text.
 * key is `${candidateId}#s${sampleIndex}` — stable across runs, so a recorded
 * file keyed this way replays even if the judge template is later reworded.
 *
 * Modes:
 *   dryRunFile set  → replay from the recorded file; no network, no key needed.
 *   otherwise       → live API calls; if recordFile is set, flush() writes a
 *                     replayable fixture after the run.
 */
export function makeJudge({ model, maxTokens, apiKey, dryRunFile, recordFile }) {
  if (dryRunFile) {
    let recorded;
    try {
      recorded = JSON.parse(readFileSync(dryRunFile, 'utf8'));
    } catch (e) {
      throw new Error(`--dry-run: cannot read ${dryRunFile}: ${e.message}`);
    }
    const responses = recorded.responses ?? {};
    return {
      mode: 'dry-run',
      model: recorded.model ?? model,
      async judge(key) {
        if (!(key in responses)) {
          throw new Error(
            `--dry-run: no recorded response for "${key}" in ${dryRunFile}. ` +
            `Re-record with --record, or check that candidates/--samples match the recording.`
          );
        }
        return responses[key];
      },
      flush() {},
    };
  }

  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Export it for a live run, or use --dry-run <recorded.json> to replay offline.'
    );
  }
  const captured = {};
  return {
    mode: 'live',
    model,
    async judge(key, prompt) {
      const text = await callAnthropic({ model, prompt, maxTokens, apiKey });
      if (recordFile) captured[key] = text;
      return text;
    },
    flush() {
      if (recordFile) {
        writeFileSync(
          recordFile,
          JSON.stringify({ model, recordedAt: new Date().toISOString(), responses: captured }, null, 2) + '\n'
        );
      }
    },
  };
}
