import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiPost: post }));
vi.mock('../preview/preview-client', () => ({
  PreviewClient: () => <button type="button">Preview gesture</button>,
}));

import { ExperienceApprovalClient } from './approval-client';

const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => {
  cleanup();
  post.mockReset();
});
it('keeps owner confirmation outside the clipped preview and sends only the exact action/intent', async () => {
  post.mockResolvedValue({ status: 'verifying' });
  render(
    <ExperienceApprovalClient
      view={{
        approvalId: id,
        merchantId: id,
        kind: 'lifecycle',
        action: 'publish',
        buildId: id,
        effectDigest: 'a'.repeat(64),
        enabled: true,
        summary: { unsafe: '<script>no</script>' },
      }}
    />
  );
  const preview = screen.getByRole('region', {
    name: 'Clipped interactive preview',
  });
  const confirm = screen.getByRole('button', { name: 'Confirm publication' });
  expect(preview.contains(confirm)).toBe(false);
  expect(document.querySelector('script')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Preview gesture' }));
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/builder-experience/approval', {
      action: 'confirm-publication',
      approvalId: id,
    })
  );
  await screen.findByText('verifying');
  expect(confirm).toBeDisabled();
});
it('missing runtime cannot enable confirmation', () => {
  render(
    <ExperienceApprovalClient
      view={{
        approvalId: id,
        merchantId: id,
        kind: 'draft',
        action: 'apply',
        effectDigest: 'a'.repeat(64),
        enabled: false,
      }}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Confirm private apply' })
  ).toBeDisabled();
});

it('leaves confirmation disabled and makes no request for an unknown action', () => {
  render(
    <ExperienceApprovalClient
      view={{
        approvalId: id,
        merchantId: id,
        kind: 'lifecycle',
        action: 'unexpected-action',
        effectDigest: 'a'.repeat(64),
        enabled: true,
      }}
    />
  );
  const confirm = screen.getByRole('button', {
    name: 'Confirmation unavailable',
  });
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  expect(post).not.toHaveBeenCalled();
});

it('reports confirmation failure and leaves the action disabled for retry', async () => {
  post.mockRejectedValue(Error('temporary failure'));
  render(
    <ExperienceApprovalClient
      view={{
        approvalId: id,
        merchantId: id,
        kind: 'draft',
        action: 'apply',
        effectDigest: 'a'.repeat(64),
        enabled: true,
      }}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm private apply' })
  );
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Confirmation unavailable. Read the current approval before retrying.'
  );
  expect(
    screen.getByRole('button', { name: 'Confirm private apply' })
  ).toBeDisabled();
});

it.each([
  { action: 'rollback', expected: 'confirm-publication' },
  { action: 'draft-only', expected: 'confirm-mode-exit' },
  { action: 'restore-legacy', expected: 'confirm-mode-exit' },
  { action: 'unpublish-legacy-draft', expected: 'confirm-mode-exit' },
])('maps known lifecycle action $action to $expected', async ({
  action,
  expected,
}) => {
  post.mockResolvedValue({ status: 'verifying' });
  render(
    <ExperienceApprovalClient
      view={{
        approvalId: id,
        merchantId: id,
        kind: 'lifecycle',
        action,
        effectDigest: 'a'.repeat(64),
        enabled: true,
      }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/builder-experience/approval', {
      action: expected,
      approvalId: id,
    })
  );
});

it.each([
  {
    response: {},
    message: 'Confirmation received. Reload to verify the current state.',
  },
  { response: { version: 0 }, message: 'Private draft version 0' },
])('handles bounded confirmation response %j without inventing a version', async ({
  response,
  message,
}) => {
  post.mockResolvedValue(response);
  render(
    <ExperienceApprovalClient
      view={{
        approvalId: id,
        merchantId: id,
        kind: 'draft',
        action: 'apply',
        effectDigest: 'a'.repeat(64),
        enabled: true,
      }}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm private apply' })
  );
  expect(await screen.findByRole('status')).toHaveTextContent(message);
  expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
});
