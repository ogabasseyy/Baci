import { describe, expect, it } from 'vitest';
import { createAssignmentWindow } from './create-assignment-window';

describe('createAssignmentWindow', () => {
  it('creates a 90-minute assignment window', () => {
    expect(
      createAssignmentWindow(new Date('2026-08-24T10:00:00.000Z'))
    ).toEqual({
      assignedAt: '2026-08-24T10:00:00.000Z',
      expiresAt: '2026-08-24T11:30:00.000Z',
    });
  });
});
