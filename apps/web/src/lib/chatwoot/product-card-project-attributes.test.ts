import { describe, expect, it } from 'vitest';
import { projectAttributes } from './product-card-project-attributes';

describe('projectAttributes', () => {
  it('projects allow-listed option keys and rejects ambiguous ones', () => {
    expect(projectAttributes(null)).toEqual({});
    expect(projectAttributes('x')).toBeNull();
    expect(projectAttributes({ Color: ' Blue ', secret: 'x' })).toEqual({
      color: 'Blue',
    });
    expect(projectAttributes({ sim_type: 'dual' })).toEqual({
      'sim type': 'dual',
    });
    expect(projectAttributes({ color: 'a', colour: 'b' })).toEqual({
      color: 'a',
      colour: 'b',
    });
    expect(projectAttributes({ color: 'a', COLOR: 'c' })).toBeNull();
    expect(projectAttributes({ color: 'a', ' color ': 'b' })).toBeNull();
    expect(projectAttributes({ color: 3 })).toBeNull();
    expect(projectAttributes({ color: 'x'.repeat(81) })).toBeNull();
    expect(projectAttributes({ ['k'.repeat(41)]: 'x' })).toBeNull();
  });
});
