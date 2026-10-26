import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ApprovalPage, { metadata } from './page';

const initial = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ view: null, error: null, signedOut: false })
);
vi.mock('@/lib/website-builder/owner-publication-view', () => ({
  loadInitialPublicationApproval: initial,
}));
vi.mock('./approval-client', () => ({
  ApprovalClient: ({ intentId }: { intentId: string }) => (
    <p>Intent:{intentId || 'missing'}</p>
  ),
}));
it('keeps owner approval out of indexing/referrers and shows a pending state', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(metadata.referrer).toBe('no-referrer');
  expect(
    ApprovalPage({ searchParams: new Promise(() => {}) }).props.fallback.props
      .role
  ).toBe('status');
});
it('passes only the intent identifier, with an empty fallback', async () => {
  for (const params of [{ intent: 'intent-id' }, {}]) {
    const element = ApprovalPage({ searchParams: Promise.resolve(params) });
    const content = element.props.children;
    const view = render(await content.type(content.props));
    expect(
      screen.getByText(
        `Intent:${'intent' in params ? params.intent : 'missing'}`
      )
    ).toBeInTheDocument();
    expect(initial).toHaveBeenLastCalledWith(
      'intent' in params ? params.intent : ''
    );
    view.unmount();
  }
});
