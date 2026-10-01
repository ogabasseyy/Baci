import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { describe, expect, it } from 'vitest';
import { builderAiEditContract, describeBuilderAiOperation } from './index';

describe('builder AI edit candidate contract', () => {
  it('parses the deterministic versioned request and candidate fixture', () => {
    expect(
      builderAiEditContract.requestSchema.safeParse(
        builderAiEditTestFixture.request
      ).success
    ).toBe(true);
    expect(
      builderAiEditContract.candidateSchema.safeParse(
        builderAiEditTestFixture.candidate
      ).success
    ).toBe(true);
  });

  it('rejects unknown candidate keys and warnings beyond the bounded response', () => {
    expect(
      builderAiEditContract.candidateSchema.safeParse({
        ...builderAiEditTestFixture.candidate,
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      builderAiEditContract.candidateSchema.safeParse({
        ...builderAiEditTestFixture.candidate,
        warnings: Array.from({ length: 11 }, () => 'Safe warning'),
      }).success
    ).toBe(false);
    expect(
      builderAiEditContract.candidateSchema.safeParse({
        ...builderAiEditTestFixture.candidate,
        operations: Array.from({ length: 6 }, () => ({
          initialContent: { componentType: 'Text', content: 'A safe note' },
          kind: 'insert_component',
          placement: { position: 'first_content' },
        })),
      }).success
    ).toBe(false);
  });

  it('permits a warning-only candidate when no automatic operation is safe', () => {
    expect(
      builderAiEditContract.candidateSchema.safeParse({
        ...builderAiEditTestFixture.candidate,
        operations: [],
        warnings: ['Media changes require Baci manual asset controls.'],
      }).success
    ).toBe(true);
  });

  it('describes operations without exposing copy, media, or URLs', () => {
    expect(
      describeBuilderAiOperation({
        componentId: 'hero-1',
        kind: 'update_component',
        patch: { componentType: 'Hero', title: 'Private copy' },
      })
    ).toBe('Update Hero text');
    expect(
      describeBuilderAiOperation(
        {
          componentId: 'newsletter-1',
          destination: { position: 'first_content' },
          kind: 'move_component',
        },
        'Newsletter'
      )
    ).toBe('Move Newsletter');
    expect(
      describeBuilderAiOperation({ kind: 'update_theme', preset: 'luxury' })
    ).toBe('Apply Luxury theme');
  });
});
