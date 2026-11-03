import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ExperienceSemanticFallback } from './ExperienceSemanticFallback';

it('renders semantic content as text and blocks stale or executable extraction', () => {
  render(
    <ExperienceSemanticFallback
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
      currentRevision: 'new',
      snapshot: { revision: 'r', path: '/', nodes: [] },
    })
  ).toThrow('SNAPSHOT_STALE');
  expect(() =>
    ExperienceSemanticFallback({
      currentRevision: 'r',
      snapshot: {
        revision: 'r',
        path: '/',
        nodes: [{ tag: 'script', children: [] }],
      },
    })
  ).toThrow();
});
