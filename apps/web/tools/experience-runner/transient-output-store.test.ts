import { expect, it } from 'vitest';
import { createTransientOutputStore } from './transient-output-store';

it('isolates immutable candidate bytes from caller mutations and expires only transient data', () => {
  const store = createTransientOutputStore();
  const input = { value: 'original' };
  const id = store.put(input, 1);
  input.value = 'changed';
  expect(store.read(id, 2)).toEqual({ value: 'original' });
  (store.read(id, 2) as { value: string }).value = 'another';
  expect(store.read(id, 2)).toEqual({ value: 'original' });
  store.sweep(86400001);
  expect(() => store.read(id, 86400001)).toThrow('NOT_FOUND');
});
