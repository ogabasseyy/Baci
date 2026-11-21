import { z } from 'zod';

export const modelCartCredentialSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
  .describe(
    'Exact opaque cartCredential returned by the previous tool call. Never guess or display it.'
  );
