import { describe, expect, it } from 'vitest';
import { parseModelProposal } from './parse-model-proposal';

const proposal = {
  query: 'iPhone 14',
  explanation: 'Latest Apple phone.',
  filters: { brands: ['Apple'], condition: 'new' as const },
};

describe('parseModelProposal', () => {
  it('accepts a plain JSON proposal envelope', () => {
    expect(parseModelProposal(JSON.stringify(proposal))).toEqual(proposal);
  });
  it('unfences provider code blocks before parsing', () => {
    expect(
      parseModelProposal(`\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``)
    ).toEqual(proposal);
    expect(
      parseModelProposal(`\`\`\`\n${JSON.stringify(proposal)}\n\`\`\``)
    ).toEqual(proposal);
  });
  it('rejects oversized payloads before parsing', () => {
    expect(() => parseModelProposal(`"${'x'.repeat(8192)}"`)).toThrow(
      'Proposal too large'
    );
  });
  it('retains strict domain validation', () => {
    expect(() =>
      parseModelProposal(JSON.stringify({ ...proposal, query: '!' }))
    ).toThrow();
    expect(() =>
      parseModelProposal(JSON.stringify({ ...proposal, extra: true }))
    ).toThrow();
  });
});
