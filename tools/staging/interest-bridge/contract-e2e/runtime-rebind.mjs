import { CONTRACT_E2E } from './constants.mjs';

export function rebindDisposableRuntimeStorage(source, systemId) {
  if (
    !/^[0-9]{1,20}$/.test(systemId) ||
    systemId === CONTRACT_E2E.runtimeStoragePin ||
    source.split(CONTRACT_E2E.runtimeStoragePin).length !== 2 ||
    !source.includes("current_user <> 'supabase_admin'")
  )
    throw new Error('Disposable storage guard rebinding refused');
  return source.replace(CONTRACT_E2E.runtimeStoragePin, systemId);
}
