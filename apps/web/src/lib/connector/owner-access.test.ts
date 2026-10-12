import { expect, it } from 'vitest';
import { canManageConnectorConnection } from './owner-access';

it('permits only owners', () => {
  expect(canManageConnectorConnection({ isOwner: true })).toBe(true);
  expect(canManageConnectorConnection({ isOwner: false })).toBe(false);
});
