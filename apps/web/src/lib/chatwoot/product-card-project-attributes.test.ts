import { describe, expect, it } from 'vitest';
import { projectAttributes } from './product-card-project-attributes';

describe('projectAttributes', () => {
  it('projects allow-listed option keys and rejects ambiguous ones', () => {
    expect(projectAttributes(null)).toEqual({});
    expect(projectAttributes('x')).toBeNull();
    expect(projectAttributes({ Color: ' Blue ', sku: 'x' })).toEqual({
      color: 'Blue',
    });
    expect(projectAttributes({ sim_type: 'dual' })).toEqual({
      sim_type: 'dual',
    });
    expect(projectAttributes({ color: 'a', colour: 'b' })).toBeNull();
    expect(projectAttributes({ color: 'a', COLOR: 'c' })).toBeNull();
    expect(projectAttributes({ color: 'a', ' color ': 'b' })).toBeNull();
    expect(projectAttributes({ color: 3 })).toBeNull();
    expect(projectAttributes({ color: 'x'.repeat(81) })).toBeNull();
    expect(projectAttributes({ ['k'.repeat(41)]: 'x' })).toBeNull();
  });

  it('bugfix: keeps processor and merchant-defined purchase axes so variants stay distinct', () => {
    expect(
      projectAttributes({ Processor: 'Intel Ultra 7', Flavor: ' Mint ' })
    ).toEqual({ processor: 'Intel Core Ultra 7', flavor: 'Mint' });
    expect(projectAttributes({ storage: '256 gb' })).toEqual({
      storage: '256GB',
    });
  });
});
