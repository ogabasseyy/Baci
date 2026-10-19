import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { draftClosureReviewFixture } from '../../../../../packages/shared/src/lib/piggyvest-draft-closure.test-support';
import { PiggyvestDraftClosureBinding } from './PiggyvestDraftClosureBinding';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
it('requires native consent, recovers lost closure response and never claims refund', async () => {
  const data = await draftClosureReviewFixture();
  render(<PiggyvestDraftClosureBinding {...data} />);
  expect(screen.getByText('<b>Plain fixture terms</b>')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Close plan' })).toBeDisabled();
  data.loseResponse();
  fireEvent.press(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Close plan' }));
  });
  expect(screen.getByText(/Closure outcome unconfirmed/)).toBeTruthy();
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh plan closure' })
    );
  });
  expect(
    screen.getByText(
      'Plan closed. No refund issued; no provider wallet deleted.'
    )
  ).toBeTruthy();
  expect(data.calls()).toBe(1);
});
it('retained native callback cannot reuse consent after refresh or a conflicting operation', async () => {
  const data = await draftClosureReviewFixture();
  let compatible = true;
  render(
    <PiggyvestDraftClosureBinding {...data} isCompatible={() => compatible} />
  );
  fireEvent.press(screen.getByRole('checkbox'));
  let node: ReturnType<typeof screen.getByRole> | null = screen.getByRole(
    'button',
    { name: 'Close plan' }
  );
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  const retained = node?.props.onPress;
  expect(typeof retained).toBe('function');
  await act(async () => {
    await data.binding.refresh();
  });
  await act(async () => {
    retained();
    await Promise.resolve();
  });
  compatible = false;
  await act(async () => {
    retained();
    await Promise.resolve();
  });
  expect(data.calls()).toBe(0);
});
