import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { hasClosedDisclosure } from './review-handoff-disclosure';

describe('hasClosedDisclosure', () => {
  it.each([
    '<details><summary>Overview</summary><p>Additional detail</p></details>',
    '<details name="group"><summary>Overview</summary><p>Detail</p></details>',
    '<details data-open="yes"><summary>Overview</summary><p>Detail</p></details>',
  ])('detects closed disclosure markup: %s', (html) => {
    expect(hasClosedDisclosure(html)).toBe(true);
  });

  it.each([
    '<details open><summary>Overview</summary><p>Detail</p></details>',
    '<details open=""><summary>Overview</summary><p>Detail</p></details>',
    '<details open="false"><summary>Overview</summary><p>Detail</p></details>',
    '<summary>Orphan summary</summary>',
    '<p>Visible article</p>',
    '<!-- <details><summary>Note</summary></details> --><p>Body</p>',
  ])('accepts open or non-disclosure markup: %s', (html) => {
    expect(hasClosedDisclosure(html)).toBe(false);
  });

  it('rejects closed disclosure markup at import', () => {
    // Neither the sanitizer nor the editor represents details/summary,
    // so sanitization unwraps the control and stores collapsed content
    // as permanently visible text.
    expect(() =>
      validateImportedContent(
        '<details><summary>Overview</summary><p>Additional detail</p></details><p>Body</p>'
      )
    ).toThrow('disclosure');
  });

  it('accepts open disclosure markup at import', () => {
    expect(
      validateImportedContent(
        '<details open><summary>Overview</summary><p>Detail</p></details><p>Body</p>'
      )
    ).toContain('Detail');
  });
});
