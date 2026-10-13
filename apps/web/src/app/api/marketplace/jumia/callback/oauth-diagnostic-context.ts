import { jumiaOAuthDiagnostic } from '@/lib/jumia/oauth-diagnostic';
import { jumiaOAuthDiagnosticIdSchema } from '@/schemas/jumia/oauth-diagnostic';

export type JumiaOAuthDiagnosticContext =
  | { status: 'ordinary'; diagnosticId?: undefined }
  | { status: 'diagnostic'; diagnosticId: string }
  | { status: 'invalid' };

export function parseJumiaOAuthDiagnosticContext({
  diagnosticId,
  storedState,
}: {
  diagnosticId: string | undefined;
  storedState: string;
}): JumiaOAuthDiagnosticContext {
  const diagnosticIdResult =
    jumiaOAuthDiagnosticIdSchema.safeParse(diagnosticId);
  const diagnosticStateBound = jumiaOAuthDiagnostic.isStateBound(storedState);
  const diagnosticMarkerPresent = diagnosticId !== undefined;

  if (!diagnosticStateBound) {
    if (diagnosticMarkerPresent) {
      return { status: 'invalid' };
    }
    return { status: 'ordinary' };
  }

  if (!diagnosticIdResult.success) {
    return { status: 'invalid' };
  }

  return { diagnosticId: diagnosticIdResult.data, status: 'diagnostic' };
}
