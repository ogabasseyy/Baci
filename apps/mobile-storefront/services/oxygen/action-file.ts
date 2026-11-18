import {
  type OxygenRuntimeAction,
  type OxygenTransientFile,
  validateOxygenFile,
} from '@baci/shared/oxygen';
import { OxygenClientError } from './errors';
export function assertOxygenActionFile(
  command: OxygenRuntimeAction,
  file?: OxygenTransientFile
) {
  const needsFile = ['submit_address', 'approve_booking'].includes(
    command.action
  );
  if (
    needsFile !== Boolean(file) ||
    (file && !validateOxygenFile(file.bytes, file.type, file.name)) ||
    (command.action === 'approve_booking' &&
      file &&
      !['image/jpeg', 'image/png'].includes(file.type))
  )
    throw new OxygenClientError('invalid', undefined, 'not_dispatched');
}
