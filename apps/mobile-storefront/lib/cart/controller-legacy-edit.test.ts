import { editLocalCartOnly } from './controller-legacy-edit';

const item = {
  id: 'a',
  product_id: 'p',
  slug: 'p',
  name: 'P',
  price: 1,
  quantity: 2,
};
function setup(overrides: Record<string, unknown> = {}) {
  const options = {
    merchantId: 'm',
    getLegacy: () => ({ items: [item] }),
    repairLegacy: jest.fn(),
    status: jest.fn(),
    client: { context: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
  const receipts = { read: jest.fn().mockResolvedValue(null) };
  return { options, receipts };
}
const run = (t: ReturnType<typeof setup>, action: never, engaged = false) =>
  editLocalCartOnly(t.options as never, t.receipts as never, action, engaged);

it('edits the local lines when no shared cart exists', async () => {
  const t = setup();
  expect(
    await run(t, { type: 'quantity', id: 'a', quantity: 5 } as never)
  ).toBe(true);
  expect(t.options.repairLegacy).toHaveBeenCalledWith([
    { ...item, quantity: 5 },
  ]);
  expect(await run(t, { type: 'remove', id: 'a' } as never)).toBe(true);
  expect(t.options.repairLegacy).toHaveBeenLastCalledWith([]);
});

it('leaves the edit to the server when a cart is in play or a request is saved', async () => {
  expect(await run(setup(), { type: 'clear' } as never, true)).toBe(false);
  const saved = setup();
  saved.receipts.read.mockResolvedValue({ operationId: 'op' });
  expect(await run(saved, { type: 'clear' } as never)).toBe(false);
  expect(await run(setup(), { type: 'add' } as never)).toBe(false);
});
