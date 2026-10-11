import { describe, expect, it } from 'vitest';
import { sizeLayerVerdicts } from './review-handoff-size-layers';

// Six chars per expectation: base, sm, md, lg, xl, 2xl.
function flags(values: boolean[]): string {
  return values.map((value) => (value ? 'T' : 'F')).join('');
}

describe('sizeLayerVerdicts', () => {
  it('reports uncovered axes with no zero or rescue', () => {
    const verdicts = sizeLayerVerdicts([]);
    for (const axis of [verdicts.height, verdicts.width]) {
      expect(flags(axis.coveredAt)).toBe('FFFFFF');
      expect(flags(axis.zeroAt)).toBe('FFFFFF');
      expect(flags(axis.maxZeroAt)).toBe('FFFFFF');
      expect(flags(axis.minRescuesAt)).toBe('FFFFFF');
    }
    expect(flags(verdicts.clipsXAt)).toBe('FFFFFF');
    expect(flags(verdicts.clipsYAt)).toBe('FFFFFF');
  });

  it('reports merged zero winners', () => {
    const verdicts = sizeLayerVerdicts(['h-0']);
    expect(flags(verdicts.height.coveredAt)).toBe('TTTTTT');
    expect(flags(verdicts.height.zeroAt)).toBe('TTTTTT');
    expect(flags(verdicts.width.coveredAt)).toBe('FFFFFF');
  });

  it('prefers axis winners over same-layer size values', () => {
    const verdicts = sizeLayerVerdicts(['size-0', 'h-64']);
    expect(flags(verdicts.height.zeroAt)).toBe('FFFFFF');
    expect(flags(verdicts.width.zeroAt)).toBe('TTTTTT');
  });

  it('reports maximum zeros and minimum rescues', () => {
    expect(flags(sizeLayerVerdicts(['max-h-0']).height.maxZeroAt)).toBe(
      'TTTTTT'
    );
    expect(flags(sizeLayerVerdicts(['min-h-full']).height.minRescuesAt)).toBe(
      'TTTTTT'
    );
    expect(flags(sizeLayerVerdicts(['min-h-0']).height.minRescuesAt)).toBe(
      'FFFFFF'
    );
  });

  it('resolves responsive winners per point', () => {
    const verdicts = sizeLayerVerdicts(['h-0', 'md:h-auto']);
    expect(flags(verdicts.height.coveredAt)).toBe('TTTTTT');
    expect(flags(verdicts.height.zeroAt)).toBe('TTFFFF');
  });

  it('resolves dark winners per scheme', () => {
    const classes = ['h-0', 'dark:h-auto'];
    expect(flags(sizeLayerVerdicts(classes).height.zeroAt)).toBe('TTTTTT');
    expect(flags(sizeLayerVerdicts(classes, 'dark').height.zeroAt)).toBe(
      'FFFFFF'
    );
  });

  it('reports clipping per axis', () => {
    const both = sizeLayerVerdicts(['overflow-hidden']);
    expect(flags(both.clipsXAt)).toBe('TTTTTT');
    expect(flags(both.clipsYAt)).toBe('TTTTTT');
    const xOnly = sizeLayerVerdicts(['overflow-x-clip']);
    expect(flags(xOnly.clipsXAt)).toBe('TTTTTT');
    expect(flags(xOnly.clipsYAt)).toBe('FFFFFF');
  });
});
