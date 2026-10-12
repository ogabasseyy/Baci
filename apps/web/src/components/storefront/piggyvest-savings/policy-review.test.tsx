import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PolicyReview } from './policy-review';
import type { PolicyReviewProps } from './policy-review.types';

const draft = {
  status: 'draft',
  goalId: '10000000-0000-4000-8000-000000000001',
  revisionId: '20000000-0000-4000-8000-000000000001',
  device: {
    productName: 'Synthetic phone',
    variant: '128 GB / Green',
    condition: 'Used',
  },
  terms: {
    version: 'synthetic-v1',
    hash: 'a'.repeat(64),
    text: 'Synthetic terms only.\n<img src=x onerror=alert(1)>',
  },
  consent: 'required',
} satisfies PolicyReviewProps['view'];

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function accept() {
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'I accept the supplied terms for this draft.',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Accept draft terms' }));
}

describe('PolicyReview', () => {
  it('displays and submits duration, resetting even when the same revision changes duration', async () => {
    const pending = deferred();
    const onAccept = vi.fn(() => pending.promise);
    const view = render(
      <PolicyReview
        sessionKey="session-a"
        view={{ ...draft, durationMonths: 3 }}
        onAccept={onAccept}
      />
    );
    expect(screen.getByText('3 months')).toBeVisible();
    accept();
    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ durationMonths: 3 })
    );
    view.rerender(
      <PolicyReview
        sessionKey="session-a"
        view={{ ...draft, durationMonths: 4 }}
        onAccept={onAccept}
      />
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await act(async () => {
      pending.resolve();
    });
    expect(
      screen.getByRole('button', { name: 'Accept draft terms' })
    ).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Consent is required');
  });
  it('fails closed for an invalid trusted projection', () => {
    render(
      <PolicyReview
        sessionKey="session-a"
        view={{ ...draft, terms: { ...draft.terms, hash: 'invalid' } }}
        onAccept={vi.fn(async () => undefined)}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Draft review is unavailable.'
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(draft.device.productName)).toBeNull();
  });
  it('omits the variant row for an exact nonvariant product', () => {
    render(
      <PolicyReview
        sessionKey="session-a"
        view={{ ...draft, device: { ...draft.device, variant: null } }}
        onAccept={vi.fn(async () => undefined)}
      />
    );
    expect(screen.getByText(draft.device.productName)).toBeVisible();
    expect(screen.queryByText('Variant')).toBeNull();
    expect(screen.queryByText(draft.device.variant)).toBeNull();
  });
  it('renders supplied device and exact plain-text terms with explicit unchecked consent', () => {
    const onAccept = vi.fn(async () => undefined);
    const { container } = render(
      <PolicyReview sessionKey="session-a" view={draft} onAccept={onAccept} />
    );

    expect(
      screen.getByRole('region', { name: 'Draft policy review' })
    ).toBeVisible();
    for (const value of Object.values(draft.device))
      expect(screen.getByText(value)).toBeVisible();
    expect(
      screen.getByText(draft.terms.text, { normalizer: (value) => value })
    ).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Staging')).toBeVisible();
    expect(
      screen.getByText('Test environment only. Review of draft terms only.')
    ).toBeVisible();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    const button = screen.getByRole('button', { name: 'Accept draft terms' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('submits only current acceptance fields, disables pending actions and awaits fresh GET consent', async () => {
    const action = deferred();
    const onAccept = vi.fn(() => action.promise);
    render(
      <PolicyReview sessionKey="session-a" view={draft} onAccept={onAccept} />
    );

    accept();
    expect(onAccept).toHaveBeenCalledExactlyOnceWith({
      goalId: draft.goalId,
      revisionId: draft.revisionId,
      termsHash: draft.terms.hash,
      termsVersion: draft.terms.version,
      accepted: true,
    });
    expect(screen.getByRole('checkbox')).toBeDisabled();
    const button = screen.getByRole('button', { name: 'Accept draft terms' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Submitting acceptance…'
    );
    await act(async () => action.resolve());
    expect(screen.getByRole('status')).toHaveTextContent(
      'Acceptance submitted. Refresh the draft to confirm its recorded consent.'
    );
    expect(screen.queryByText('Consent recorded for this draft.')).toBeNull();
    expect(
      screen.queryByText(/activated|funds are safe|guaranteed/i)
    ).toBeNull();
  });

  it('redacts errors and permits an explicit retry', async () => {
    const onAccept = vi
      .fn<PolicyReviewProps['onAccept']>()
      .mockRejectedValueOnce(new Error('private-provider-error'))
      .mockResolvedValueOnce(undefined);
    render(
      <PolicyReview sessionKey="session-a" view={draft} onAccept={onAccept} />
    );

    await act(async () => accept());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Acceptance could not be confirmed. Retry or refresh this draft.'
    );
    expect(screen.queryByText('private-provider-error')).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Retry acceptance' }))
    );
    expect(onAccept).toHaveBeenCalledTimes(2);
  });

  const changes: [string, Partial<PolicyReviewProps>][] = [
    ['session', { sessionKey: 'session-b' }],
    [
      'goal',
      { view: { ...draft, goalId: '10000000-0000-4000-8000-000000000002' } },
    ],
    [
      'revision',
      {
        view: { ...draft, revisionId: '20000000-0000-4000-8000-000000000002' },
      },
    ],
    [
      'terms hash',
      { view: { ...draft, terms: { ...draft.terms, hash: 'b'.repeat(64) } } },
    ],
    [
      'terms version',
      {
        view: { ...draft, terms: { ...draft.terms, version: 'synthetic-v2' } },
      },
    ],
    [
      'terms text',
      {
        view: {
          ...draft,
          terms: { ...draft.terms, text: 'Changed synthetic terms.' },
        },
      },
    ],
    [
      'device',
      { view: { ...draft, device: { ...draft.device, condition: 'New' } } },
    ],
  ];

  it.each(
    changes
  )('resets selection and pending state on %s change and ignores stale success', async (_name, change) => {
    const action = deferred();
    const onAccept = vi.fn(() => action.promise);
    const props = { sessionKey: 'session-a', view: draft, onAccept };
    const { rerender } = render(<PolicyReview {...props} />);
    accept();

    rerender(<PolicyReview {...props} {...change} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
    await act(async () => action.resolve());
    expect(screen.getByRole('status')).toHaveTextContent(
      'Consent is required for this draft.'
    );
    expect(
      screen.getByRole('button', { name: 'Accept draft terms' })
    ).toBeDisabled();
    rerender(<PolicyReview {...props} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Consent is required for this draft.'
    );
  });

  it('discards a late failure after logout and same-session return', async () => {
    const action = deferred();
    const onAccept = vi.fn(() => action.promise);
    const { rerender } = render(
      <PolicyReview sessionKey="session-a" view={draft} onAccept={onAccept} />
    );
    accept();
    rerender(
      <PolicyReview sessionKey={null} view={draft} onAccept={onAccept} />
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    rerender(
      <PolicyReview sessionKey="session-a" view={draft} onAccept={onAccept} />
    );
    await act(async () => action.reject(new Error('private')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('clears a displayed error when the revision changes', async () => {
    const onAccept = vi.fn(async () => {
      throw new Error('private');
    });
    const { rerender } = render(
      <PolicyReview sessionKey="session-a" view={draft} onAccept={onAccept} />
    );
    await act(async () => accept());
    expect(screen.getByRole('alert')).toBeVisible();
    rerender(
      <PolicyReview
        sessionKey="session-a"
        view={{ ...draft, revisionId: '20000000-0000-4000-8000-000000000002' }}
        onAccept={onAccept}
      />
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it.each([
    'loading',
    'unavailable',
  ] as const)('removes draft details in %s state', (status) => {
    const onAccept = vi.fn(async () => undefined);
    const { rerender } = render(
      <PolicyReview sessionKey="session-a" view={draft} onAccept={onAccept} />
    );
    rerender(
      <PolicyReview
        sessionKey="session-a"
        view={{ status }}
        onAccept={onAccept}
      />
    );
    expect(screen.queryByText(draft.device.productName)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows server-recorded consent without another acceptance action', () => {
    render(
      <PolicyReview
        sessionKey="session-a"
        view={{ ...draft, consent: 'accepted' }}
        onAccept={vi.fn(async () => undefined)}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Consent recorded for this draft.'
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
