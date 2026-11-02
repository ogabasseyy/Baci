import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { frozenRouteHashFinding } from '../../../tools/events/event-pipeline-boundary-hash';
import { eventPipelineFrozenRoutes } from './event-pipeline-frozen-authority-sources';

it('retains the reviewed authority receipt for the POD checkout route', () => {
  const path = 'apps/web/src/app/api/orders/route.ts';
  expect(
    frozenRouteHashFinding(
      path,
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '../../app/api/orders/route.ts'
        )
      ),
      eventPipelineFrozenRoutes[path]
    )
  ).toBeUndefined();
});
