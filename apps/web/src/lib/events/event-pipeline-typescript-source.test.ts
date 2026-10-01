import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { parseEventPipelineTypeScriptSource } from './event-pipeline-typescript-source';

describe('parseEventPipelineTypeScriptSource', () => {
  it.each([
    ['view.jsx', ts.LanguageVariant.JSX],
    ['view.tsx', ts.LanguageVariant.JSX],
    ['worker.js', ts.LanguageVariant.JSX],
    ['worker.mjs', ts.LanguageVariant.JSX],
    ['worker.cjs', ts.LanguageVariant.JSX],
    ['worker.mts', ts.LanguageVariant.Standard],
    ['worker.cts', ts.LanguageVariant.Standard],
  ])('selects the parser grammar for %s', (path, languageVariant) => {
    expect(
      parseEventPipelineTypeScriptSource(path, 'export const value = true;')
        .languageVariant
    ).toBe(languageVariant);
  });
});
