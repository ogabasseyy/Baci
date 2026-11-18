import { z } from 'zod';

/** A goal id from a link (old goal-actions URLs): only a UUID is used. */
export const goalIdParamSchema = z.uuid();
