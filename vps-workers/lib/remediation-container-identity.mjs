export function resolveRemediationContainerIdentity({
  containerIdentity,
} = {}) {
  const identity = containerIdentity || {
    gid: typeof process.getgid === 'function' ? process.getgid() : null,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
  };
  const { gid, uid } = identity;
  if (
    !Number.isSafeInteger(uid) ||
    uid <= 0 ||
    !Number.isSafeInteger(gid) ||
    gid <= 0
  ) {
    throw new Error(
      'remediation container identity requires a non-root worker uid and gid'
    );
  }
  return { gid, uid };
}
