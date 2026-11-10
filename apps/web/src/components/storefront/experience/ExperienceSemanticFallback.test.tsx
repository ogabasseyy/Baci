import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ExperienceSemanticFallback } from './ExperienceSemanticFallback';

it('renders semantic content as text and blocks stale or executable extraction', () => {
  render(
    <ExperienceSemanticFallback
      canonicalBase="https://baci.test/qa1"
      currentRevision="r"
      snapshot={{
        revision: 'r',
        path: '/',
        nodes: [
          { tag: 'h1', children: [{ text: 'Synthetic <script> price' }] },
        ],
      }}
    />
  );
  expect(screen.getByRole('heading').textContent).toBe(
    'Synthetic <script> price'
  );
  expect(() =>
    ExperienceSemanticFallback({
      canonicalBase: 'https://baci.test/qa1',
      currentRevision: 'new',
      snapshot: { revision: 'r', path: '/', nodes: [] },
    })
  ).toThrow('SNAPSHOT_STALE');
  expect(() =>
    ExperienceSemanticFallback({
      canonicalBase: 'https://baci.test/qa1',
      currentRevision: 'r',
      snapshot: {
        revision: 'r',
        path: '/',
        nodes: [{ tag: 'script', children: [] }],
      },
    })
  ).toThrow();
});

it('keeps retained links inside the trusted path-based merchant storefront', () => {
  render(
    <ExperienceSemanticFallback
      canonicalBase="https://baci.test/qa1"
      currentRevision="r"
      snapshot={{
        revision: 'r',
        path: '/',
        nodes: [
          {
            tag: 'a',
            href: '/products/item',
            children: [{ text: 'View item' }],
          },
        ],
      }}
    />
  );
  expect(screen.getByRole('link', { name: 'View item' })).toHaveAttribute(
    'href',
    'https://baci.test/qa1/products/item'
  );
});
