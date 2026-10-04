import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ConnectorConnectionView } from '@/schemas/connector';
import { ConnectionList } from './connection-list';
import { makeModel } from './model.test-support';

it('requires confirmation and disconnects only the selected connection', () => {
  const connection: ConnectorConnectionView = {
    grantId: 'grant-a',
    connectionId: 'agent-a',
    merchantId: 'merchant-a',
    branchIds: [],
    merchantWide: true,
    scopes: ['orders:read'],
    status: 'active' as const,
    version: 1,
    expiresAt: null,
    usable: true,
  };
  const model = makeModel({ status: { connections: [connection] } });
  const { rerender } = render(<ConnectionList model={model} />);
  fireEvent.click(screen.getByRole('button', { name: /^Disconnect$/ }));
  expect(model.setConfirmingDisconnect).toHaveBeenCalledWith('grant-a');
  expect(model.handleDisconnect).not.toHaveBeenCalled();
  rerender(
    <ConnectionList model={{ ...model, confirmingDisconnect: 'grant-a' }} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
  expect(model.handleDisconnect).toHaveBeenCalledWith('grant-a');
});
