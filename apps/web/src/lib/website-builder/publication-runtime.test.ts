import { expect, it, vi } from 'vitest';
import {
  getOwnerPublicationRuntime,
  installOwnerPublicationRuntime,
} from './publication-runtime';

vi.mock('./owner-publication-handler', () => ({
  createOwnerPublicationHandler: () => async () => new Response('owner'),
}));
it('requires explicit installation and permits one owner runtime until disposal', () => {
  expect(getOwnerPublicationRuntime()).toBeUndefined();
  const deps = {} as Parameters<typeof installOwnerPublicationRuntime>[0];
  const dispose = installOwnerPublicationRuntime(deps);
  const first = getOwnerPublicationRuntime();
  expect(first).toBeTypeOf('function');
  expect(() => installOwnerPublicationRuntime(deps)).toThrow(
    'already installed'
  );
  dispose();
  expect(getOwnerPublicationRuntime()).toBeUndefined();
  const next = installOwnerPublicationRuntime(deps);
  dispose();
  expect(getOwnerPublicationRuntime()).toBeTypeOf('function');
  next();
  expect(getOwnerPublicationRuntime()).toBeUndefined();
});
