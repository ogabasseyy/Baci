import { expect, it } from 'vitest';
import { portableHomeSchema } from '../../src/schemas/portable-storefront';
import { home } from '../builder-preview-spike/fixtures';
import {
  normalizePublicationCopy,
  publicationVisibleCopy,
} from './publication-visible-copy';

it('includes every supported block copy, including hero and navigation actions', () => {
  const parsed = portableHomeSchema.parse(home);
  expect(
    parsed.content.map((block) =>
      publicationVisibleCopy(block).map((copy) => copy.text)
    )
  ).toEqual([
    ['Shop'],
    [
      'Our cameras',
      'A snapshot with exact shared presentation',
      'Shop cameras',
    ],
    ['About us', 'Merchant supplied copy'],
    ['Explore'],
    ['Featured Products'],
    ['© Fixture. All rights reserved.', 'Quick Links', 'Contact'],
  ]);
  const footer = parsed.content.find((block) => block.type === 'Footer');
  if (footer?.type !== 'Footer') throw Error('fixture');
  footer.props.quickLinks = [];
  expect(publicationVisibleCopy(footer)).toEqual([
    { text: '© Fixture. All rights reserved.' },
  ]);
  expect(normalizePublicationCopy(' More\n  copy\u00a0here ')).toBe(
    'More copy here'
  );
});
