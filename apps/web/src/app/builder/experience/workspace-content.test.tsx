import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  user: true,
  owner: true,
  fail: false,
  from: vi.fn(),
  eq: vi.fn(),
  merchant: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: f.user ? { id: 'user' } : null },
        error: null,
      }),
    },
    from: f.from,
  }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: f.merchant,
}));
vi.mock('./workspace-client', () => ({
  ExperienceWorkspace: (props: unknown) => (
    <pre data-testid="workspace">{JSON.stringify(props)}</pre>
  ),
}));

import { ExperienceWorkspaceContent as Page } from './workspace-content';

const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.clearAllMocks();
  f.user = true;
  f.owner = true;
  f.fail = false;
  f.merchant.mockImplementation(async () => ({
    merchantId: id,
    staffAccess: { isOwner: f.owner },
  }));
  f.from.mockImplementation((name: string) => {
    const result = {
      data: name === 'experience_builds' ? [] : null,
      error: f.fail ? { message: 'private database details' } : null,
    };
    const q = {
      select: () => q,
      eq: (...args: unknown[]) => {
        f.eq(...args);
        return q;
      },
      order: () => q,
      limit: async () => result,
      maybeSingle: async () => result,
    };
    return q;
  });
});
it('signed-out or staff cannot query source or see owner controls', async () => {
  f.user = false;
  render(await Page({ searchParams: Promise.resolve({ merchant: id }) }));
  expect(
    screen.getByRole('link', { name: 'Sign in as the store owner' })
  ).toHaveAttribute('href', '/login');
  expect(f.from).not.toHaveBeenCalled();
  f.user = true;
  f.owner = false;
  render(await Page({ searchParams: Promise.resolve({ merchant: id }) }));
  expect(
    screen.getByText(
      'Only the store owner can read private source or confirm changes.'
    )
  ).toBeVisible();
  expect(f.from).not.toHaveBeenCalled();
});
it('owner queries only resolved tenant; uninstalled runtime leaves controls disabled', async () => {
  render(await Page({ searchParams: Promise.resolve({ merchant: id }) }));
  expect(f.eq).toHaveBeenCalledWith('merchant_id', id);
  expect(
    f.eq.mock.calls.every(
      ([key, value]) => key !== 'merchant_id' || value === id
    )
  ).toBe(true);
  expect(
    JSON.parse(screen.getByTestId('workspace').textContent ?? '{}')
  ).toMatchObject({
    merchantId: id,
    enabled: false,
    builds: [],
    sourceVersion: 0,
  });
});
it('malformed tenant and database errors return a safe unavailable workspace', async () => {
  render(
    await Page({ searchParams: Promise.resolve({ merchant: 'not-a-uuid' }) })
  );
  expect(
    screen.getByRole('heading', { name: 'Experience workspace unavailable' })
  ).toBeVisible();
  expect(f.from).not.toHaveBeenCalled();
  f.fail = true;
  render(await Page({ searchParams: Promise.resolve({ merchant: id }) }));
  expect(
    screen.queryByText('private database details')
  ).not.toBeInTheDocument();
  expect(screen.queryByTestId('workspace')).not.toBeInTheDocument();
});

it('lists all bounded source paths in deterministic path order', async () => {
  const original = f.from.getMockImplementation();
  if (!original) throw Error('Missing synthetic query implementation');
  f.from.mockImplementation((name: string) => {
    if (
      ![
        'experience_source_heads',
        'experience_source_files',
        'experience_artifacts',
      ].includes(name)
    )
      return original(name);
    let ordered = false;
    const q = {
      select: () => q,
      eq: () => q,
      order: (column: string, options: { ascending: boolean }) => {
        ordered = column === 'path' && options.ascending;
        return q;
      },
      maybeSingle: async () => ({
        data:
          name === 'experience_source_heads'
            ? { artifact_id: id, version: 1 }
            : { source_digest: 'a'.repeat(64) },
        error: null,
      }),
      limit: async (limit: number) => {
        expect(limit).toBe(128);
        return {
          data: (ordered
            ? ['app.tsx', 'style.css']
            : ['style.css', 'app.tsx']
          ).map((path) => ({ path })),
          error: null,
        };
      },
    };
    return q;
  });
  render(await Page({ searchParams: Promise.resolve({ merchant: id }) }));
  expect(
    JSON.parse(screen.getByTestId('workspace').textContent ?? '{}').paths
  ).toEqual(['app.tsx', 'style.css']);
});
