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

describe('remediation research gate refusals', () => {
  it('rejects a report that selects no defensible fix', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: no defensible fix is established'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, false);
    assert.match(result.reasons.join('\n'), /defensible selected fix/);
  });

  it('rejects a report that qualifies the missing fix with extra wording', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: no defensible code fix is established; gather more evidence'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, false);
    assert.match(result.reasons.join('\n'), /defensible selected fix/);
  });

  it('rejects a report that says a defensible fix cannot be established', () => {
    const result = validateCodexResearchResult(
      jsonl(
        validReport.replace(
          'SELECTED_FIX: smallest code fix',
          'SELECTED_FIX: A defensible fix cannot be established without production traces.'
        )
      )
    );

    assert.equal(result.accepted, false);
    assert.match(result.reasons.join('\n'), /defensible selected fix/);
  });

  it('rejects a report that cannot justify a safe code change', () => {
    const result = validateCodexResearchResult(
      jsonl(
        validReport.replace(
          'SELECTED_FIX: smallest code fix',
          'SELECTED_FIX: No safe code change can be justified from the available evidence; collect production traces.'
        )
      )
    );

    assert.equal(result.accepted, false);
    assert.match(result.reasons.join('\n'), /defensible selected fix/);
  });

  it('rejects passive reports that leave the selected fix unavailable', () => {
    const reports = [
      'SELECTED_FIX: The defensible fix was not identified from the available evidence.',
      'SELECTED_FIX: The safe code change has not been established.',
      'SELECTED_FIX: The selected fix is unavailable without production traces.',
    ];

    for (const selectedFix of reports) {
      const result = validateCodexResearchResult(
        jsonl(
          validReport.replace('SELECTED_FIX: smallest code fix', selectedFix)
        )
      );

      assert.equal(result.accepted, false);
      assert.match(result.reasons.join('\n'), /defensible selected fix/);
    }
  });

  it('rejects passive wording with qualifiers between not and established', () => {
    const reports = [
      'SELECTED_FIX: A defensible fix has not yet been established.',
      'SELECTED_FIX: The safe code change has not yet been determined from evidence.',
    ];

    for (const selectedFix of reports) {
      const result = validateCodexResearchResult(
        jsonl(
          validReport.replace('SELECTED_FIX: smallest code fix', selectedFix)
        )
      );

      assert.equal(result.accepted, false);
      assert.match(result.reasons.join('\n'), /defensible selected fix/);
    }
  });

  it('rejects reverse-order wording that cannot establish a defensible fix', () => {
    const reports = [
      'SELECTED_FIX: I cannot establish a defensible fix without production traces.',
      'SELECTED_FIX: I could not identify a defensible fix from the available evidence.',
    ];

    for (const selectedFix of reports) {
      const result = validateCodexResearchResult(
        jsonl(
          validReport.replace('SELECTED_FIX: smallest code fix', selectedFix)
        )
      );

      assert.equal(result.accepted, false);
      assert.match(result.reasons.join('\n'), /defensible selected fix/);
    }
  });

  it('rejects an explicit conclusion that no safe fix can be determined', () => {
    const result = validateCodexResearchResult(
      jsonl(
        validReport.replace(
          'SELECTED_FIX: smallest code fix',
          'SELECTED_FIX: I cannot determine a safe fix from the available evidence; apply the bounded parser change'
        )
      )
    );

    assert.equal(result.accepted, false);
    assert.match(result.reasons.join('\n'), /defensible selected fix/);
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

  it('rejects deferred-fix conclusions that require more investigation', () => {
    const reports = [
      'SELECTED_FIX: Further investigation is required before a safe fix can be selected.',
      'SELECTED_FIX: More production traces are needed before a defensible fix can be established.',
    ];

    for (const selectedFix of reports) {
      const result = validateCodexResearchResult(
        jsonl(
          validReport.replace('SELECTED_FIX: smallest code fix', selectedFix)
        )
      );

      assert.equal(result.accepted, false);
      assert.match(result.reasons.join('\n'), /defensible selected fix/);
    }
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

  it('rejects reordered no-fix conclusions with safely established', () => {
    const reports = [
      'SELECTED_FIX: No fix can be safely established from the available evidence; collect production traces.',
      'SELECTED_FIX: No fix can be established without production traces.',
    ];

    for (const selectedFix of reports) {
      const result = validateCodexResearchResult(
        jsonl(
          validReport.replace('SELECTED_FIX: smallest code fix', selectedFix)
        )
      );

      assert.equal(result.accepted, false);
      assert.match(result.reasons.join('\n'), /defensible selected fix/);
    }
  });

  it('accepts a reordered refusal that selects a fallback instead', () => {
    const report = validReport.replace(
      'SELECTED_FIX: smallest code fix',
      'SELECTED_FIX: No fix can be safely established yet, so apply the bounded workaround'
    );

    const result = validateCodexResearchResult(jsonl(report));

    assert.equal(result.accepted, true);
  });

  it('rejects research unable-to conclusions at the start of the selection', () => {
    const reports = [
      'SELECTED_FIX: Unable to identify a defensible fix from the evidence.',
      'SELECTED_FIX: I am unable to determine a safe fix from the evidence.',
      "SELECTED_FIX: I'm unable to justify a safe change from the evidence.",
    ];

    for (const selectedFix of reports) {
      const result = validateCodexResearchResult(
        jsonl(
          validReport.replace('SELECTED_FIX: smallest code fix', selectedFix)
        )
      );

      assert.equal(result.accepted, false);
      assert.match(result.reasons.join('\n'), /defensible selected fix/);
    }
  });

  it('rejects standalone none refusals at the start of the selection', () => {
    const reports = [
      'SELECTED_FIX: None.',
      'SELECTED_FIX: None of the options work from the available evidence.',
    ];

    for (const selectedFix of reports) {
      const result = validateCodexResearchResult(
        jsonl(
          validReport.replace('SELECTED_FIX: smallest code fix', selectedFix)
        )
      );

      assert.equal(result.accepted, false);
      assert.match(result.reasons.join('\n'), /defensible selected fix/);
    }
  });
});
