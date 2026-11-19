import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ExperienceWorkspacePage, { metadata } from './page';

vi.mock('./workspace-content', () => ({
  ExperienceWorkspaceContent: () => <h1>Owner workspace</h1>,
}));

it('keeps the private workspace out of search and renders the workspace boundary', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
  render(<ExperienceWorkspacePage searchParams={Promise.resolve({})} />);
  expect(
    screen.getByRole('heading', { name: 'Owner workspace' })
  ).toBeVisible();
});
