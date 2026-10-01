import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.fn();
const mockToast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));
vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

import { EventPipelineOperations } from './event-pipeline-operations';

const data = {
  counts: { deliveries: 1, ingress: 0, unknown: 0 },
  deliveries: [
    {
      attempts: 2,
      destination: 'ga4',
      event_name: 'order.paid',
      id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
      last_error_code: 'timeout',
      replay_count: 0,
      updated_at: '2026-08-05T15:02:00.000Z',
    },
  ],
  ingress: [],
  operations: { deliveries: [], heartbeats: [], queue: null },
  unknown: [],
};

describe('EventPipelineOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires a reason and confirmation before calling the existing replay endpoint', async () => {
    const user = userEvent.setup();
    mockFetchWithCsrf.mockResolvedValue({
      json: async () => ({ replayed: 1, success: true }),
      ok: true,
    });
    render(
      <EventPipelineOperations
        canReplay={true}
        data={data}
        onComplete={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Replay' }));
    const confirm = screen.getByRole('button', { name: 'Confirm replay' });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Replay reason' }),
      'GA4 credentials were repaired'
    );
    await user.click(confirm);

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/admin/event-pipeline/replay',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Replay queued' })
    );
  });

  it('does not render replay controls for read-only operations users', () => {
    render(
      <EventPipelineOperations
        canReplay={false}
        data={data}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText(/read-only incident view/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Replay' })
    ).not.toBeInTheDocument();
    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
  });
});
