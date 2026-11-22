import type {
  OxygenTransientFile,
  oxygenRuntimeSubmissionSchema,
} from '@baci/shared/oxygen';
import type { z } from 'zod';
import type { OxygenClient } from './client';
import { OxygenClientError } from './errors';
import type { OxygenIntentJournal } from './journal';
/** Only explicit proof of a preclaim rejection releases a persisted dispatch fence. */
export async function dispatchOxygenAction(
  client: OxygenClient,
  journal: OxygenIntentJournal,
  submission: z.infer<typeof oxygenRuntimeSubmissionSchema>,
  file: OxygenTransientFile | undefined,
  isCurrent: () => boolean
) {
  try {
    return await client.action(submission, file);
  } catch (error) {
    if (
      error instanceof OxygenClientError &&
      error.dispatchState === 'not_dispatched' &&
      isCurrent()
    ) {
      const saved = await journal.read();
      if (
        saved?.workflowId === submission.workflowId &&
        saved.key === submission.idempotencyKey &&
        saved.version === submission.version &&
        saved.action === submission.command.action &&
        isCurrent()
      )
        await journal.clear();
    }
    throw error;
  }
}
