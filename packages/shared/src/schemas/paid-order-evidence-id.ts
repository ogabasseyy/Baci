import { z } from 'zod';

export const paidOrderEvidenceIdSchema = z.string().uuid();
