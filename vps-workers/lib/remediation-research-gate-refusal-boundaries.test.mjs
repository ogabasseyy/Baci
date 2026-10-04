import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateCodexResearchResult } from './remediation-research-gate.mjs';

const validReport = [
  'RESEARCH_SUMMARY: traced the failure to the bounded parser.',
  'ROOT_CAUSE_CONFIDENCE: medium',
  'OPTIONS_CONSIDERED:',
  '- smallest code fix',
  '- operational mitigation',
  'SELECTED_FIX: smallest code fix',
  'VALIDATION_PLAN: run the focused regression suite',
].join('\n');

const jsonl = (text) =>
  `${JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text },
  })}\n${JSON.stringify({ type: 'turn.completed' })}\n`;

describe('remediation research gate refusal boundaries', () => {
  it('accepts affirmative cannot wording that still selects a fix', () => {
    const reports = [
      'SELECTED_FIX: Apply a bound so hostile input cannot bypass the safe parser fix',
      'SELECTED_FIX: I cannot identify a safe fix yet, so apply the bounded workaround',
    ];

    for (const selectedFix of reports) {
      const result = validateCodexResearchResult(
        jsonl(
          validReport.replace('SELECTED_FIX: smallest code fix', selectedFix)
        )
      );

      assert.equal(result.accepted, true);
    }
  });

  it('accepts affirmative wording that rejects rejecting the selected fix', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: There is no defensible reason to reject this fix; apply the bounded parser change'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('accepts a fallback selection when the upstream fix is unavailable', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: The upstream fix is unavailable in the pinned version, so apply the bounded local workaround'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('accepts an explicit selection with an incidental none clause', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: Apply Option A; none of the public APIs change'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('accepts a deferred conclusion that still selects a fallback', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: Further investigation is required before a safe fix can be selected, so apply the bounded workaround'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('accepts a selection with third-party unable-to wording', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: Add the bounded fallback when the provider is unable to return the optional field'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('accepts a reordered refusal that selects a fallback instead', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: No fix can be safely established yet, so apply the bounded workaround'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('accepts a not-found refusal that selects a fallback instead', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: No safe fix could be found yet, so apply the bounded workaround'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('accepts an insufficient-evidence refusal that selects a fallback instead', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: Insufficient evidence exists to select a safe fix yet, so apply the bounded workaround'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('accepts an affirmative selection with incidental cannot-safely wording', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: Reject payloads that cannot safely be parsed before they reach the transformer'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });
});
