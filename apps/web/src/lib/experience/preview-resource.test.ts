import { expect, it, vi } from 'vitest';
import { authorizePreviewResource } from './preview-resource';

it('encoded traversal and malformed tickets never reach private resource storage', async () => {
  const read = vi.fn();
  await expect(
    authorizePreviewResource({ read } as never, 'bad', 'app.js')
  ).rejects.toThrow('NOT_FOUND');
  await expect(
    authorizePreviewResource({ read } as never, 'a'.repeat(64), '%2e%2e/app.js')
  ).rejects.toThrow('NOT_FOUND');
  expect(read).not.toHaveBeenCalled();
});
