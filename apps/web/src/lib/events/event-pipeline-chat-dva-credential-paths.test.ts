import { expect, it } from 'vitest';
import { eventPipelineChatDvaCredentialPaths as paths } from './event-pipeline-chat-dva-credential-paths';

it('allows only the scoped signer path and no admin or service factory', () => {
  expect(paths).toHaveLength(1);
  const [path] = paths;
  expect(path[0]).toBe(
    'apps/web/src/lib/payments/begin-paystack-dva-attempt.ts'
  );
  expect(
    path.some((entry) => /supabase\/(admin|service)\.ts$/.test(entry))
  ).toBe(false);
});
