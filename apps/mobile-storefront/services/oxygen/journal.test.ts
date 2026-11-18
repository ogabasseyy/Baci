import { OxygenIntentJournal } from './journal';

const id = '11111111-1111-4111-8111-111111111111';
const scope = {
  storageKey: 'oxygen-staging',
  userId: id,
  merchantId: id,
  orderId: id,
};
it('stores only bounded nonsensitive metadata and rejects extra body fields', async () => {
  const storage = {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn(),
  };
  const journal = new OxygenIntentJournal(storage, scope);
  await journal.write({
    scope,
    workflowId: id,
    action: 'approve_booking',
    version: 3,
    key: id,
    time: 123,
  });
  expect(storage.setItem.mock.calls[0][1]).not.toContain('otp');
  await expect(
    journal.write({
      scope,
      workflowId: id,
      action: 'approve_booking',
      version: 3,
      key: id,
      time: 123,
      otp: '123456',
    } as never)
  ).rejects.toThrow();
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});
it('does not restore another scope', async () => {
  const storage = {
    getItem: jest.fn().mockResolvedValue(
      JSON.stringify({
        scope: { ...scope, storageKey: 'production' },
        workflowId: id,
        action: 'book',
        version: 1,
        key: id,
        time: 1,
      })
    ),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  };
  expect(await new OxygenIntentJournal(storage, scope).read()).toBeNull();
});
it('compares scope values independently of object property order', async () => {
  const storage = {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn(),
  };
  const journal = new OxygenIntentJournal(storage, {
    orderId: id,
    merchantId: id,
    userId: id,
    storageKey: scope.storageKey,
  });
  await journal.write({
    scope,
    workflowId: id,
    action: 'book',
    version: 1,
    key: id,
    time: 1,
  });
  storage.getItem.mockResolvedValue(storage.setItem.mock.calls[0][1]);
  expect((await journal.read())?.key).toBe(id);
});
