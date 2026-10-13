import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizAdminClient } from './quiz-admin-client';

const mockApiPost = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}));

const prize = {
  available: true,
  condition: 'new',
  defaultVariantId: null,
  effectiveStock: 2,
  hasVariants: false,
  id: '55555555-5555-4555-8555-555555555555',
  imageUrl: 'https://cdn.example.com/iphone.png',
  manageStock: true,
  name: 'iPhone XR',
  price: 300000,
  requiresVariantSelection: false,
  selectionId: '55555555-5555-4555-8555-555555555555:product',
  variantId: null,
  variantLabel: null,
};

const generated = {
  event: {
    id: 'event-1',
    slug: 'daily-phone-quiz',
    status: 'draft',
    title: 'Daily Phone Quiz',
  },
  questions: [
    {
      correctOptionId: 'b',
      difficulty: 'standard',
      explanation: 'USB-C arrived on iPhone 15.',
      options: [
        { id: 'a', label: 'iPhone 13' },
        { id: 'b', label: 'iPhone 15' },
      ],
      prompt: 'Which iPhone model introduced USB-C?',
      topic: 'iPhone buying advice',
    },
  ],
};

describe('QuizAdminClient activation timing', () => {
  beforeEach(() => mockApiPost.mockReset());

  it.each([
    { manual: false, seconds: 100 },
    { manual: true, seconds: 150 },
  ])('uses generated play time unless the immediate window was edited ($manual)', async ({
    manual,
    seconds,
  }) => {
    mockApiPost
      .mockResolvedValueOnce({
        ...generated,
        questions: Array.from({ length: 10 }, () => generated.questions[0]),
      })
      .mockResolvedValueOnce({
        event: { ...generated.event, status: 'active' },
      });
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    await user.selectOptions(
      screen.getByLabelText(/launch timing/i),
      'immediate'
    );
    if (manual)
      fireEvent.change(screen.getByLabelText(/total quiz duration/i), {
        target: { value: '150' },
      });
    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: /reviewed every correct answer/i,
      })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /launch quiz/i,
      })
    );
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
    expect(mockApiPost).toHaveBeenLastCalledWith(
      '/api/merchant/quiz/activate',
      expect.objectContaining({
        timing: { kind: 'immediate', liveWindowSeconds: seconds },
      })
    );
  });

  it('resyncs the auto-derived end from the generated count before activation', async () => {
    // Regression: Gemma may return a different count than requested (the
    // schema allows 1–50), and activation validates the window against the
    // actual questions. The form requests 2 questions but the draft below
    // carries 10 x 10s = 100s of play: the scheduled end must resync to
    // ~100s (not the requested-based 60s) so activation accepts it.
    const tenQuestions = {
      ...generated,
      questions: Array.from({ length: 10 }, () => generated.questions[0]),
    };
    mockApiPost.mockResolvedValueOnce(tenQuestions).mockResolvedValueOnce({
      event: { ...generated.event, status: 'active' },
    });
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: /reviewed every correct answer/i,
      })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: /launch quiz/i })
    );
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
    const [, payload] = mockApiPost.mock.calls.at(-1) as [
      unknown,
      {
        timing: { endsAt: string; kind: string; startsAt: string };
      },
    ];
    expect(payload.timing.kind).toBe('scheduled');
    const spanSeconds =
      (Date.parse(payload.timing.endsAt) -
        Date.parse(payload.timing.startsAt)) /
      1000;
    expect(spanSeconds).toBeGreaterThan(60);
    expect(spanSeconds).toBeGreaterThanOrEqual(100);
    expect(spanSeconds).toBeLessThanOrEqual(160);
  });

  it('rejects stale scheduled dates before posting an activation request', async () => {
    // Regression: expired starts disable draft generation (activation
    // rejects starts that are not in the future), so no generate request
    // is ever posted for them.
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Launch timing' }),
      'scheduled'
    );
    await user.clear(screen.getByLabelText(/scheduled start/i));
    await user.type(
      screen.getByLabelText(/scheduled start/i),
      '2020-01-01T09:00'
    );
    await user.clear(screen.getByLabelText(/universal end/i));
    await user.type(
      screen.getByLabelText(/universal end/i),
      '2020-01-01T09:05'
    );

    expect(
      screen.getByRole('button', { name: /generate draft/i })
    ).toBeDisabled();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('preserves Lagos wall-clock schedule times in the activation payload', async () => {
    mockApiPost.mockResolvedValueOnce(generated).mockResolvedValueOnce({
      event: { ...generated.event, status: 'scheduled' },
    });
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Launch timing' }),
      'scheduled'
    );
    await user.clear(screen.getByLabelText(/scheduled start/i));
    await user.type(
      screen.getByLabelText(/scheduled start/i),
      '2027-08-06T09:00'
    );
    await user.clear(screen.getByLabelText(/universal end/i));
    await user.type(
      screen.getByLabelText(/universal end/i),
      '2027-08-06T09:05'
    );
    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: /reviewed every correct answer/i,
      })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /launch quiz/i,
      })
    );

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
    expect(mockApiPost).toHaveBeenLastCalledWith(
      '/api/merchant/quiz/activate',
      expect.objectContaining({
        timeZone: 'Africa/Lagos',
        timing: {
          endsAt: '2027-08-06T08:05:00.000Z',
          kind: 'scheduled',
          startsAt: '2027-08-06T08:00:00.000Z',
        },
      })
    );
  });
});
