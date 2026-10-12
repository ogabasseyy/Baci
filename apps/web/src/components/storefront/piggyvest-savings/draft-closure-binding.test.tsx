import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { draftClosureReviewFixture } from '../../../../../../packages/shared/src/lib/piggyvest-draft-closure.test-support';
import {
  BoundDraftClosureReview,
  type DraftClosureBinding,
} from './draft-closure-binding';

it('requires explicit plain-text consent then recovers response loss without a duplicate close', async () => {
  const data = await draftClosureReviewFixture();
  const rendered = render(<BoundDraftClosureReview {...data} />);
  expect(screen.getByText('<b>Plain fixture terms</b>')).toBeVisible();
  expect(rendered.container.querySelector('b')).toBeNull();
  expect(screen.getByRole('button', { name: 'Close plan' })).toBeDisabled();
  data.loseResponse();
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Close plan' }));
  });
  expect(screen.getByRole('status')).toHaveTextContent('unconfirmed');
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh plan closure' })
    );
  });
  expect(screen.getByRole('status')).toHaveTextContent('No refund issued');
  expect(data.calls()).toBe(1);
});
it('blocks same-tick conflicting operation and mapped exposure', async () => {
  const data = await draftClosureReviewFixture();
  let compatible = true;
  const view = render(
    <BoundDraftClosureReview {...data} isCompatible={() => compatible} />
  );
  fireEvent.click(screen.getByRole('checkbox'));
  compatible = false;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Close plan' }));
  });
  expect(data.calls()).toBe(0);
  const mapped = await draftClosureReviewFixture();
  mapped.mapped();
  await mapped.binding.refresh();
  view.rerender(<BoundDraftClosureReview {...mapped} />);
  expect(screen.getByRole('status')).toHaveTextContent('reconciliation');
  expect(screen.queryByRole('button', { name: 'Close plan' })).toBeNull();
});
it('malformed binding fails closed', () => {
  render(
    <BoundDraftClosureReview
      source={null}
      binding={{} as DraftClosureBinding}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('unavailable');
});
