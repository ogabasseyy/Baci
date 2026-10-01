import { describe, expect, it } from 'vitest';
import { builderComponentDataSchema } from './builder-component-data';

describe('builderComponentDataSchema', () => {
  it('defaults legacy props and rejects blank component types', () => {
    expect(builderComponentDataSchema.parse({ type: 'Hero' }).props).toEqual(
      {}
    );
    expect(builderComponentDataSchema.safeParse({ type: ' ' }).success).toBe(
      false
    );
  });
});
