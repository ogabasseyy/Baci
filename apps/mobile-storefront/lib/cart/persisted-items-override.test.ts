import {
  bindPersistedItemsOverride,
  persistedItemsOverride,
} from './persisted-items-override';

const line = { id: 'l1' } as never;

it('returns nothing until a controller binds, and again after it unbinds', () => {
  expect(persistedItemsOverride()).toBeNull();
  const unbind = bindPersistedItemsOverride(() => [line]);
  expect(persistedItemsOverride()).toEqual([line]);
  unbind();
  expect(persistedItemsOverride()).toBeNull();
});

it('does not unbind a newer controller when an older one cleans up late', () => {
  const unbindOld = bindPersistedItemsOverride(() => [line]);
  const unbindNew = bindPersistedItemsOverride(() => []);
  unbindOld();
  expect(persistedItemsOverride()).toEqual([]);
  unbindNew();
});
