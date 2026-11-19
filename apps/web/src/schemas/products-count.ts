import { z } from 'zod';

export const merchantIdSchema = z.string().uuid();
