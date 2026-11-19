import { z } from 'zod';

/** PostgreSQL accepts any 8-4-4-4-12 hexadecimal UUID, regardless of RFC bits. */
export const postgresUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
