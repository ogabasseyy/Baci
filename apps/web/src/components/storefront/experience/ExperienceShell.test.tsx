import '@testing-library/jest-dom/vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  path: '/qa1',
  present: () => {},
  push: vi.fn(),
  active: vi.fn(async () => true),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: f.push, refresh: vi.fn() }),
  usePathname: () => f.path,
}));
vi.mock('@/hooks/cart/cart-context', () => ({ useCartSafe: () => null }));
vi.mock('./experience-host-runtime', () => ({
  createPublishedExperienceHost: (v: { present: () => void }) => {
    f.present = v.present;
    return { host: {}, isActive: f.active };
  },
}));
vi.mock('./ExperienceFrame', () => ({
  ExperienceFrame: ({ admitted }: { admitted?: boolean }) => (
    <p data-admitted={String(admitted)}>Custom source frame</p>
  ),
}));

import { ExperienceRouteBoundary } from './ExperienceRouteBoundary';
import { ExperienceShell } from './ExperienceShell';

it('keeps trusted checkout confirmation outside authored content and navigates only after its native button', async () => {
  const data = {
    title: 'Synthetic store',
    canonicalUrl: 'http://localhost/qa1',
    manifest: {
      buildDigest: 'b',
      policyRevision: 'p',
      routes: [{ path: '/', view: 'home' }],
    },
    launch: { instanceId: 'i', canonicalBase: 'http://localhost/qa1' },
    bootstrap: { route: { epoch: 1 }, catalog: { products: [] } },
  };
  render(
    <ExperienceShell merchantSlug="qa1">
      <ExperienceRouteBoundary
        data={data as never}
        fallback={<p>Current fallback</p>}
      />
    </ExperienceShell>
  );
  await screen.findByText('Custom source frame');
  act(() => f.present());
  expect(
    screen.getByRole('dialog', { name: 'Continue to checkout' })
  ).toBeVisible();
  const dialog = screen.getByRole('dialog', { name: 'Continue to checkout' });
  expect(dialog).toHaveAttribute('data-state', 'open');
  expect(dialog.parentElement).toBe(document.body);
  expect(f.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to checkout' }));
  await waitFor(() => expect(f.push).toHaveBeenCalledWith('/qa1/checkout'));
});

it('binds after a focus verification supersedes the initial admission read', async () => {
  f.active.mockResolvedValueOnce(false).mockResolvedValue(true);
  const data = {
    title: 'Synthetic store',
    canonicalUrl: 'http://localhost/qa1',
    manifest: {
      buildDigest: 'b',
      policyRevision: 'p',
      routes: [{ path: '/', view: 'home' }],
    },
    launch: {
      instanceId: 'focus-instance',
      canonicalBase: 'http://localhost/qa1',
    },
    bootstrap: { route: { epoch: 1 }, catalog: { products: [] } },
  };
  render(
    <ExperienceShell merchantSlug="qa1">
      <ExperienceRouteBoundary
        data={data as never}
        fallback={<p>Current fallback</p>}
      />
    </ExperienceShell>
  );
  await waitFor(() => expect(f.active).toHaveBeenCalled());
  expect(screen.getByText('Custom source frame')).toHaveAttribute(
    'data-admitted',
    'false'
  );
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByText('Custom source frame');
  await waitFor(() =>
    expect(screen.getByText('Custom source frame')).toHaveAttribute(
      'data-admitted',
      'true'
    )
  );
});

it('mounts the public frame while parent admission is pending and keeps it unadmitted', async () => {
  let resolveAdmission: ((admitted: boolean) => void) | undefined;
  f.active.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        resolveAdmission = resolve;
      })
  );
  const data = {
    title: 'Synthetic store',
    canonicalUrl: 'http://localhost/qa1',
    manifest: {
      buildDigest: 'b',
      policyRevision: 'p',
      routes: [{ path: '/', view: 'home' }],
    },
    launch: {
      instanceId: 'preload-instance',
      canonicalBase: 'http://localhost/qa1',
    },
    bootstrap: { route: { epoch: 1 }, catalog: { products: [] } },
  };
  render(
    <ExperienceShell merchantSlug="qa1">
      <ExperienceRouteBoundary
        data={data as never}
        fallback={<p>Current fallback</p>}
      />
    </ExperienceShell>
  );
  const frame = await screen.findByText('Custom source frame');
  expect(frame).toHaveAttribute('data-admitted', 'false');
  await waitFor(() => expect(f.active).toHaveBeenCalled());
  await act(async () => resolveAdmission?.(true));
  await waitFor(() => expect(frame).toHaveAttribute('data-admitted', 'true'));
});

it('withdraws the frame admission when a later focus check revokes it', async () => {
  f.active.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const data = {
    title: 'Synthetic store',
    canonicalUrl: 'http://localhost/qa1',
    manifest: {
      buildDigest: 'b',
      policyRevision: 'p',
      routes: [{ path: '/', view: 'home' }],
    },
    launch: {
      instanceId: 'revoked-instance',
      canonicalBase: 'http://localhost/qa1',
    },
    bootstrap: { route: { epoch: 1 }, catalog: { products: [] } },
  };
  render(
    <ExperienceShell merchantSlug="qa1">
      <ExperienceRouteBoundary
        data={data as never}
        fallback={<p>Current fallback</p>}
      />
    </ExperienceShell>
  );
  const frame = await screen.findByText('Custom source frame');
  await waitFor(() => expect(frame).toHaveAttribute('data-admitted', 'true'));
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(frame).toHaveAttribute('data-admitted', 'false'));
});

it('withdraws frame admission when a focus verification rejects', async () => {
  f.active
    .mockReset()
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(Error('private verification detail'));
  const data = {
    title: 'Synthetic store',
    canonicalUrl: 'http://localhost/qa1',
    manifest: {
      buildDigest: 'b',
      policyRevision: 'p',
      routes: [{ path: '/', view: 'home' }],
    },
    launch: {
      instanceId: 'rejected-instance',
      canonicalBase: 'http://localhost/qa1',
    },
    bootstrap: { route: { epoch: 1 }, catalog: { products: [] } },
  };
  render(
    <ExperienceShell merchantSlug="qa1">
      <ExperienceRouteBoundary
        data={data as never}
        fallback={<p>Current fallback</p>}
      />
    </ExperienceShell>
  );
  const frame = await screen.findByText('Custom source frame');
  await waitFor(() => expect(frame).toHaveAttribute('data-admitted', 'true'));
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(frame).toHaveAttribute('data-admitted', 'false'));
});

it('retires a home-only frame when a catalog product opens its native PDP', async () => {
  f.path = '/qa1';
  f.active.mockResolvedValue(true);
  const data = {
    title: 'Synthetic',
    canonicalUrl: 'http://localhost/qa1',
    manifest: {
      buildDigest: 'b',
      policyRevision: 'p',
      routes: [{ path: '/', view: 'home' }],
    },
    launch: { instanceId: 'native-pdp', canonicalBase: 'http://localhost/qa1' },
    bootstrap: {
      route: { epoch: 1 },
      catalog: {
        products: [{ slug: 'device', canonicalPath: '/phones/device' }],
      },
    },
  };
  const { rerender } = render(
    <ExperienceShell merchantSlug="qa1">
      <ExperienceRouteBoundary
        data={data as never}
        fallback={<p>Fallback</p>}
      />
    </ExperienceShell>
  );
  await screen.findByText('Custom source frame');
  f.path = '/qa1/phones/device';
  rerender(
    <ExperienceShell merchantSlug="qa1">
      <p>Native PDP</p>
    </ExperienceShell>
  );
  await waitFor(() =>
    expect(screen.queryByText('Custom source frame')).toBeNull()
  );
  expect(screen.getByText('Native PDP')).toBeVisible();
  f.path = '/qa1';
});
