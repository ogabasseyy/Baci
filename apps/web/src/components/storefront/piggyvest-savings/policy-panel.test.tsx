import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PolicyPanel } from './policy-panel';

const goalId = '30000000-0000-4000-8000-000000000001';
const draft = {
  status: 'draft',
  goalId,
  revisionId: '70000000-0000-4000-8000-000000000001',
  device: { productName: 'Synthetic phone', variant: null, condition: 'New' },
  terms: {
    version: 'synthetic-v1',
    hash: 'a'.repeat(64),
    text: 'Synthetic draft terms only.',
  },
  consent: 'required',
};
function deferred() {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

it('aborts obsolete reads and ignores their late result after loader replacement', async () => {
  const old = deferred();
  const originalLoad = vi
    .fn<(goalId: string, signal: AbortSignal) => Promise<unknown>>()
    .mockReturnValue(old.promise);
  const replacementLoad = vi.fn().mockResolvedValue({ status: 'unavailable' });
  const submit = vi.fn();
  const { rerender, unmount } = render(
    <PolicyPanel
      sessionKey="session-a"
      goalId={goalId}
      load={originalLoad}
      submit={submit}
    />
  );
  await waitFor(() => expect(originalLoad).toHaveBeenCalledOnce());
  rerender(
    <PolicyPanel
      sessionKey="session-a"
      goalId={goalId}
      load={replacementLoad}
      submit={submit}
    />
  );
  await waitFor(() => expect(replacementLoad).toHaveBeenCalledOnce());
  expect(originalLoad.mock.calls[0][1].aborted).toBe(true);
  await act(async () => old.resolve(draft));
  expect(screen.queryByText('Synthetic phone')).not.toBeInTheDocument();
  unmount();
  expect(submit).not.toHaveBeenCalled();
});
async function agree() {
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button'));
}

it('shows recorded consent only after an exact server acknowledgement', async () => {
  const load = vi.fn().mockResolvedValue(draft);
  const submit = vi.fn().mockResolvedValue({ ...draft, consent: 'accepted' });
  render(
    <PolicyPanel
      sessionKey="session-a"
      goalId={goalId}
      load={load}
      submit={submit}
    />
  );
  await agree();
  await screen.findByText('Consent recorded for this draft.');
  expect(submit).toHaveBeenCalledWith({
    goalId,
    revisionId: draft.revisionId,
    termsHash: draft.terms.hash,
    termsVersion: draft.terms.version,
    accepted: true,
  });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it.each([
  { success: true },
  {
    ...draft,
    consent: 'accepted',
    goalId: '30000000-0000-4000-8000-000000000002',
  },
  {
    ...draft,
    consent: 'accepted',
    terms: { ...draft.terms, text: 'Different terms' },
  },
  { ...draft, consent: 'accepted', privateToken: 'synthetic-private-value' },
])('rejects mismatched or malformed consent acknowledgement', async (response) => {
  render(
    <PolicyPanel
      sessionKey="session-a"
      goalId={goalId}
      load={vi.fn().mockResolvedValue(draft)}
      submit={vi.fn().mockResolvedValue(response)}
    />
  );
  await agree();
  await screen.findByRole('alert');
  expect(
    screen.queryByText('Consent recorded for this draft.')
  ).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('synthetic-private-value');
});

it('does not let an old acceptance overwrite a returned session', async () => {
  const old = deferred();
  const load = vi.fn().mockResolvedValue(draft);
  const submit = vi.fn().mockReturnValue(old.promise);
  const { rerender } = render(
    <PolicyPanel
      sessionKey="session-a"
      goalId={goalId}
      load={load}
      submit={submit}
    />
  );
  await agree();
  await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  rerender(
    <PolicyPanel
      sessionKey={null}
      goalId={goalId}
      load={load}
      submit={submit}
    />
  );
  expect(screen.queryByText('Synthetic phone')).not.toBeInTheDocument();
  rerender(
    <PolicyPanel
      sessionKey="session-a"
      goalId={goalId}
      load={load}
      submit={submit}
    />
  );
  await screen.findByRole('checkbox');
  await act(async () => old.resolve({ ...draft, consent: 'accepted' }));
  expect(
    screen.queryByText('Consent recorded for this draft.')
  ).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it('rejects another goal from the read response and avoids unauthenticated loads', async () => {
  const load = vi.fn().mockResolvedValue({
    ...draft,
    goalId: '30000000-0000-4000-8000-000000000002',
  });
  const submit = vi.fn();
  const { rerender } = render(
    <PolicyPanel
      sessionKey={null}
      goalId={goalId}
      load={load}
      submit={submit}
    />
  );
  expect(load).not.toHaveBeenCalled();
  rerender(
    <PolicyPanel
      sessionKey="session-a"
      goalId={goalId}
      load={load}
      submit={submit}
    />
  );
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  expect(screen.queryByText('Synthetic phone')).not.toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
