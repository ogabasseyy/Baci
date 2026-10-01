import { describe, expect, it } from 'vitest';
import { resolve } from './typedoc-typescript6.mjs';

describe('TypeDoc TypeScript 6 loader', () => {
  it('redirects TypeDoc compiler API imports to TypeScript 6', () => {
    const nextResolve = (specifier, context) => ({ specifier, context });

    expect(
      resolve('typescript', { parentURL: import.meta.url }, nextResolve)
    ).toEqual({
      specifier: '@typescript/typescript6',
      context: { parentURL: import.meta.url },
    });
  });

  it('leaves unrelated imports unchanged', () => {
    const nextResolve = (specifier, context) => ({ specifier, context });

    expect(
      resolve('typedoc', { parentURL: import.meta.url }, nextResolve)
    ).toEqual({
      specifier: 'typedoc',
      context: { parentURL: import.meta.url },
    });
  });
});
