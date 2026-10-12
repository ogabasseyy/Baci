const patterns = {
  scheduling: /\bcron\s*\.|\bpg_cron\b/i,
  externalEffects:
    /\bnet\s*\.\s*http|\bhttp_(?:post|get|put|delete)\b|\bdblink\b|\bCREATE\s+SERVER\b|\bPROGRAM\b|https?:\/\//i,
  roles: /\b(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER)\b|\b(?:GRANT|REVOKE)\b/i,
  managedSchemas: /\b(?:auth|storage|graphql_public|realtime)\s*\./i,
  extensions: /\b(?:CREATE|ALTER|DROP)\s+EXTENSION\b/i,
  dataMutation: /^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|COPY\s+)/i,
  psqlCommand: /^\s*\\/,
  secretReference: /\bvault\s*\.|\b(?:password|secret|api_key|access_token)\b/i,
};

export function auditHostedSavingsSql(sql: string) {
  const findings: { category: string; line: number }[] = [];
  for (const [index, line] of sql.split('\n').entries()) {
    for (const [category, pattern] of Object.entries(patterns)) {
      if (pattern.test(line)) findings.push({ category, line: index + 1 });
    }
  }
  return findings;
}
