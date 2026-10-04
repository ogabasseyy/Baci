import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConnectForm } from './connect-form';
import { makeModel } from './model.test-support';

it('prevents connecting with empty scope or an empty branch selection', () => {
  const model = makeModel({ scopes: [] });
  const { rerender } = render(<ConnectForm model={model} />);
  expect(screen.getByRole('button', { name: 'Connect Muse' })).toBeDisabled();
  rerender(
    <ConnectForm model={makeModel({ merchantWide: false, branchIds: [] })} />
  );
  expect(screen.getByRole('button', { name: 'Connect Muse' })).toBeDisabled();
});
it('connects only after the owner clicks the enabled action', () => {
  const model = makeModel();
  render(<ConnectForm model={model} />);
  expect(model.handleConnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Connect Muse' }));
  expect(model.handleConnect).toHaveBeenCalledOnce();
});
