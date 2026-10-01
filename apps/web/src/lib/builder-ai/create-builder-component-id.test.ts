import { describe, expect, it } from 'vitest';
import { createBuilderComponentId } from './create-builder-component-id';

describe('createBuilderComponentId', () => {
  it('creates a type-prefixed UUID id that cannot be selected by model input', () => {
    const id = createBuilderComponentId('Hero');

    expect(id).toMatch(
      /^hero-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
