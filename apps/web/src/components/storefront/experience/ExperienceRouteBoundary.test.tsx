import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { ExperienceRouteBoundary } from './ExperienceRouteBoundary';
import { ExperienceShellContext } from './experience-shell-context';
import { createExperienceShellController } from './experience-shell-controller';

it('marks the fallback as pending until a real connection and offers refresh after authority loss', () => {
  const c = createExperienceShellController();
  const data = {
    manifest: { buildDigest: 'b', policyRevision: 'p' },
    launch: { instanceId: 'i' },
    bootstrap: { route: { epoch: 1 } },
  };
  render(
    <ExperienceShellContext value={c}>
      <ExperienceRouteBoundary
        data={data as never}
        fallback={<p>Current catalog</p>}
      />
    </ExperienceShellContext>
  );
  expect(
    screen.getByText('Current catalog').closest('[data-experience-pending]')
  ).toHaveAttribute('data-experience-pending', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('Loading storefront');
  act(() => c.markReady('i'));
  expect(screen.getByText('Current catalog')).not.toBeVisible();
  act(() => c.withdraw());
  expect(screen.queryByText('Current catalog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh storefront' }));
  expect(refresh).toHaveBeenCalledOnce();
});

it('restores the native catalog when the custom frame fails to connect', () => {
  const c = createExperienceShellController();
  const data = {
    manifest: { buildDigest: 'b', policyRevision: 'p' },
    launch: { instanceId: 'i' },
    bootstrap: { route: { epoch: 1 } },
  };
  render(
    <ExperienceShellContext value={c}>
      <ExperienceRouteBoundary
        data={data as never}
        fallback={<p>Recovery catalog</p>}
      />
    </ExperienceShellContext>
  );
  act(() => c.failFrame());
  expect(screen.getByText('Recovery catalog')).toBeVisible();
  expect(
    screen.getByText('Recovery catalog').closest('[data-experience-pending]')
  ).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});
