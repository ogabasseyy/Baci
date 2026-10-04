import { z } from 'zod';

export const replayAccrualSigningSecretSchema = z.string().min(16).max(1024);
