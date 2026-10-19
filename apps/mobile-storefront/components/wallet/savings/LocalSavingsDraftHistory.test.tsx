import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { draftFixture } from '@/schemas/customer-savings-drafts.test-fixture';
import { LocalSavingsDraftHistory } from './LocalSavingsDraftHistory';

it('opens the exact saved draft and distinguishes pending consent', () => {
  const onOpen = jest.fn();
  render(
    <LocalSavingsDraftHistory
      drafts={[draftFixture]}
      busy={false}
      colors={Colors.light}
      onOpen={onOpen}
    />
  );
  const toggle = screen.getByRole('button', { name: 'View saved drafts (1)' });
  expect(toggle).toHaveAccessibilityState({ expanded: false });
  expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
  fireEvent.press(toggle);
  expect(
    screen.getByRole('button', { name: 'Hide saved drafts (1)' })
  ).toHaveAccessibilityState({ expanded: true });
  expect(screen.getByText('Review terms required')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: /^Open / }));
  expect(onOpen).toHaveBeenCalledWith(draftFixture);
  fireEvent.press(
    screen.getByRole('button', { name: 'Hide saved drafts (1)' })
  );
  expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
});

it('hides empty history and disables opening during a request', () => {
  const props = { colors: Colors.light, onOpen: jest.fn() };
  const view = render(
    <LocalSavingsDraftHistory {...props} drafts={[]} busy={false} />
  );
  expect(screen.queryByText('Your saved drafts')).toBeNull();
  view.rerender(
    <LocalSavingsDraftHistory {...props} drafts={[draftFixture]} busy />
  );
  expect(screen.getByRole('button')).toBeDisabled();
});

it('clears expanded history when the real list becomes empty and returns collapsed', () => {
  const props = { colors: Colors.light, onOpen: jest.fn(), busy: false };
  const view = render(
    <LocalSavingsDraftHistory {...props} drafts={[draftFixture]} />
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'View saved drafts (1)' })
  );
  view.rerender(<LocalSavingsDraftHistory {...props} drafts={[]} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(
    <LocalSavingsDraftHistory {...props} drafts={[draftFixture]} />
  );
  expect(
    screen.getByRole('button', { name: 'View saved drafts (1)' })
  ).toHaveAccessibilityState({ expanded: false });
  expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
});
