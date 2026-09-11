export function buildCodexSandboxArgs({ readOnly }) {
  if (readOnly) {
    return [
      '--sandbox',
      'read-only',
      // Landlock avoids nested bubblewrap user namespaces on this VPS while
      // retaining Codex's process-level filesystem/network policy.
      '--enable',
      'use_legacy_landlock',
    ];
  }

  // Docker is the external write boundary for implementation runs.
  return ['--dangerously-bypass-approvals-and-sandbox'];
}
