import { expect, it } from 'vitest';
import {
  eventPipelinePaidOrderAmendmentAdminPaths as adminPaths,
  eventPipelinePaidOrderAmendmentCredentialPaths as credentialPaths,
} from './event-pipeline-paid-order-amendment-paths';

const update = 'apps/web/src/lib/orders/paid-order-amendment-update.ts';

it('pins the admin chains to the amendment update through the mail helper', () => {
  expect(adminPaths).toHaveLength(2);
  for (const path of adminPaths) {
    expect(path[0]).toBe(update);
    expect(path[1]).toBe('apps/web/src/lib/zeptomail.ts');
    expect(path.at(-1)).toBe('apps/web/src/lib/supabase/admin.ts');
  }
});

it('pins the credential chains to the amendment update and its cron route', () => {
  expect(credentialPaths).toHaveLength(4);
  for (const path of credentialPaths) {
    expect(path.at(-1)).toBe('apps/web/src/env.ts');
    expect(path.includes(update)).toBe(true);
  }
});
