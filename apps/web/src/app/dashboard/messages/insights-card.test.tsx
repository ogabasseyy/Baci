import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchInsights: vi.fn() }));
vi.mock('@/lib/merchant-inbox-api', () => ({
  fetchMerchantInboxInsights: mocks.fetchInsights,
}));

import { InsightsCard } from './insights-card';

const insights = {
  days: 7,
  conversations: 9,
  customerMessages: 31,
  storeReplies: 22,
  resolved: 6,
  avgFirstResponseSeconds: 720,
  avgResolutionSeconds: null,
  handledByAi: 2,
  handledByMerchant: null,
};

beforeEach(() => {
  mocks.fetchInsights.mockReset();
  mocks.fetchInsights.mockResolvedValue({ ok: true, insights });
});

describe('InsightsCard', () => {
  it('shows the totals and formatted reply times', async () => {
    render(<InsightsCard />);
    expect(await screen.findByText('9')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
    expect(
      screen.getByText('Replies sent (you and the assistant)')
    ).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText('12 min')).toBeInTheDocument();
    expect(
      screen.getByText('New chats answered by assistant')
    ).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('New chats handled by you')).toBeInTheDocument();
    // Time to resolve and Handled by you have nothing to show: dashes.
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(mocks.fetchInsights).toHaveBeenCalledWith(7);
  });

  it('reloads when another time range is picked', async () => {
    render(<InsightsCard />);
    await screen.findByText('9');
    await userEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(mocks.fetchInsights).toHaveBeenCalledWith(30));
  });

  it('shows a calm message when insights are unavailable', async () => {
    mocks.fetchInsights.mockResolvedValue({
      ok: false,
      code: 'temporarily_unavailable',
    });
    render(<InsightsCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Insights are temporarily unavailable.'
    );
  });

  it('shows the unavailable message when the fetch rejects', async () => {
    mocks.fetchInsights.mockRejectedValue(new Error('boom'));
    render(<InsightsCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Insights are temporarily unavailable.'
    );
  });

  it('shows a loading status while the insights are pending', () => {
    mocks.fetchInsights.mockReturnValue(new Promise(() => {}));
    render(<InsightsCard />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading insights…');
  });
});
