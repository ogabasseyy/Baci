import { describe, expect, it } from 'vitest';
import { resolveCartColorChipStyle } from './cart-item-badge-style';

describe('resolveCartColorChipStyle', () => {
  it('prioritizes chromatic names before titanium, midnight, or natural keywords', () => {
    expect(resolveCartColorChipStyle('Blue Titanium')).toEqual({
      backgroundColor: '#dbeafe',
      color: '#1e40af',
      borderColor: '#93c5fd',
    });
    expect(resolveCartColorChipStyle('Desert Titanium')).toEqual({
      backgroundColor: '#fde68a',
      color: '#78350f',
      borderColor: '#f59e0b',
    });
    expect(resolveCartColorChipStyle('Natural Titanium')).toEqual({
      backgroundColor: '#e5e7eb',
      color: '#1f2937',
      borderColor: '#9ca3af',
    });
    expect(resolveCartColorChipStyle('Midnight Green')).toEqual({
      backgroundColor: '#dcfce7',
      color: '#166534',
      borderColor: '#86efac',
    });
    expect(resolveCartColorChipStyle('Cosmic Orange')).toEqual({
      backgroundColor: '#ffedd5',
      color: '#9a3412',
      borderColor: '#fdba74',
    });
    expect(resolveCartColorChipStyle('Rose Gold')).toEqual({
      backgroundColor: '#fce7f3',
      color: '#9d174d',
      borderColor: '#f9a8d4',
    });
  });

  it('matches yellow, silver, black, and white colour families', () => {
    expect(resolveCartColorChipStyle('Yellow')).toMatchObject({
      backgroundColor: '#fef08a',
      color: '#854d0e',
    });
    expect(resolveCartColorChipStyle('Silver')).toMatchObject({
      backgroundColor: '#e4e4e7',
      color: '#27272a',
    });
    expect(resolveCartColorChipStyle('Obsidian Black')).toMatchObject({
      backgroundColor: '#1f2937',
      color: '#ffffff',
    });
    expect(resolveCartColorChipStyle('Starlight White')).toMatchObject({
      backgroundColor: '#ffffff',
      color: '#3f3f46',
    });
  });

  it('supports 3-digit and 6-digit explicit hex fallback with contrast text', () => {
    expect(resolveCartColorChipStyle('Custom Light', '#eee')).toEqual({
      backgroundColor: '#eeeeee',
      color: '#1f2937',
      borderColor: '#d4d4d8',
    });
    expect(resolveCartColorChipStyle('Custom Dark', '#112233')).toEqual({
      backgroundColor: '#112233',
      color: '#ffffff',
      borderColor: '#112233',
    });
    expect(resolveCartColorChipStyle('Blue Custom', '#123456')).toEqual({
      backgroundColor: '#123456',
      color: '#ffffff',
      borderColor: '#123456',
    });
    expect(resolveCartColorChipStyle('Neon Green', '#00ff00')).toEqual({
      backgroundColor: '#00ff00',
      color: '#1f2937',
      borderColor: '#00ff00',
    });
  });
});
