import { describe, expect, it } from 'vitest';
import { createInsertableComponentProps } from './builder-ai-component-insertable-props';

describe('createInsertableComponentProps', () => {
  it('applies only editable patches to insertable defaults', () => {
    expect(
      createInsertableComponentProps('Text', { id: 'ignored', title: 'About' })
    ).toMatchObject({ title: 'About' });
  });

  it('rejects protected components', () => {
    expect(() => createInsertableComponentProps('Header', {})).toThrow(
      'Unsupported insertable component'
    );
  });
});
