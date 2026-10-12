import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { draftFixture } from '@/schemas/customer-savings-drafts.test-fixture';
import { LocalSavingsDraftReview } from './LocalSavingsDraftReview';

it('shows the server disclosure and only accepts after explicit review', () => {
  const onAccept = jest.fn();
  render(
    <LocalSavingsDraftReview
      draft={draftFixture}
      colors={Colors.light}
      busy={false}
      canStartNewDraft={false}
      onAccept={onAccept}
      onStartNew={jest.fn()}
      onClose={jest.fn()}
    />
  );
  expect(screen.getByText(draftFixture.terms.text)).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Confirm draft terms' })
  ).toBeDisabled();
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Confirm draft terms' }));
  expect(onAccept).toHaveBeenCalledTimes(1);
});

it('disables review during a request and distinguishes saved consent from activation', () => {
  const props = {
    colors: Colors.light,
    canStartNewDraft: false,
    onAccept: jest.fn(),
    onStartNew: jest.fn(),
    onClose: jest.fn(),
  };
  const view = render(
    <LocalSavingsDraftReview {...props} draft={draftFixture} busy />
  );
  expect(screen.getByRole('checkbox')).toBeDisabled();
  view.rerender(
    <LocalSavingsDraftReview
      {...props}
      draft={{
        ...draftFixture,
        consent: 'accepted',
        acceptedAt: '2026-09-13T07:01:00Z',
      }}
      busy={false}
    />
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    screen.getByText(
      'Your draft and consent are saved. Funding and interest are not activated.'
    )
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Back to my drafts' }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
