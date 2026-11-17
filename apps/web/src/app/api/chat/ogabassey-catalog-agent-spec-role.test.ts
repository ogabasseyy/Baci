import { describe, expect, it } from 'vitest';
import { extractCapacitySpecRole } from './ogabassey-catalog-agent-spec-role';

function roleFor(text: string, token: string) {
  const start = text.indexOf(token);
  const unit = token.replace(/[\d.\s-]+/g, '');
  return extractCapacitySpecRole(text, start, start + token.length, unit);
}

describe('ogabassey-catalog-agent-spec-role', () => {
  it('binds capacity roles by closest attachment on both sides and ignores non-capacity units', () => {
    expect(roleFor('256GB internal memory', '256GB')).toBe('storage');
    expect(roleFor('8GB DDR4 RAM', '8GB')).toBe('ram');
    expect(roleFor('8GB RAM with SSD storage', '8GB')).toBe('ram');
    expect(roleFor('RAM: 8GB and storage: 256GB', '8GB')).toBe('ram');
    expect(roleFor('RAM: 8GB and storage: 256GB', '256GB')).toBe('storage');
    expect(roleFor('RAM 8GB Storage 256GB', '8GB')).toBe('ram');
    expect(roleFor('RAM 8GB Storage 256GB', '256GB')).toBe('storage');
    expect(roleFor('8GB RAM 256GB Storage', '8GB')).toBe('ram');
    expect(roleFor('8GB RAM 256GB Storage', '256GB')).toBe('storage');
    expect(roleFor('8GB RAM 256GB', '256GB')).toBeUndefined();
    expect(roleFor('8GB RAM and a 120Hz display', '120Hz')).toBeUndefined();
  });
});
