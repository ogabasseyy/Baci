"""Optional synthetic-only diagnostic; never replaces the required Semgrep scan."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile

TIMEOUTS = {
    'connectionTimeoutMillis': '  connectionTimeoutMillis: 2000,\n',
    'statement_timeout': '  statement_timeout: 2000,\n',
    'query_timeout': '  query_timeout: 3000,\n',
}
RULE = 'javascript.pg.node-pg-hardcoded-secret.node-pg-hardcoded-secret'


def fixture_cases():
    setup = """import { Client } from 'pg';
import { z } from 'zod';
const schema = z.strictObject({
  environment: z.literal('staging'), transport: z.literal('local_test'),
  socketDirectory: z.string().regex(/^\\/(?:private\\/)?tmp\\/baci-piggyvest-runtime\\.[A-Za-z0-9]+\\/socket$/),
  database: z.literal('piggyvest_local'), port: z.number().int().min(1).max(65535),
  password: z.literal('synthetic-local-only'),
});
const config = schema.parse({
  environment: 'staging', transport: 'local_test',
  socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
  database: 'piggyvest_local', port: 55451, password: 'synthetic-local-only',
});
"""
    options = """  host: config.socketDirectory,
  port: config.port,
  database: config.database,
  user: 'goal_policy_other',
""" + ''.join(TIMEOUTS.values())
    base = setup + 'export const client = new Client({\n' + options + '});\n'
    cases = {'local_baseline': base}
    for name, value in TIMEOUTS.items():
        cases['without_' + name] = base.replace(value, '')
    cases['environment_user'] = base.replace("user: 'goal_policy_other'", 'user: process.env.PG_DIAGNOSTIC_USER')
    cases['options_alias'] = setup + 'const options = {\n' + options + '};\nexport const client = new Client(options);\n'
    cases['without_unused_password'] = base.replace("  password: z.literal('synthetic-local-only'),\n", '').replace(", password: 'synthetic-local-only'", '')
    cases['literal_password'] = base.replace('new Client({\n', "new Client({\n  password: 'synthetic-diagnostic-only',\n")
    cases['environment_password'] = base.replace('new Client({\n', 'new Client({\n  password: process.env.PG_DIAGNOSTIC_PASSWORD,\n')
    dynamic = """import { Client } from 'pg';
export const client = new Client({
  host: process.env.PG_DIAGNOSTIC_HOST,
  database: process.env.PG_DIAGNOSTIC_DATABASE,
  user: process.env.PG_DIAGNOSTIC_USER,
  password: process.env.PG_DIAGNOSTIC_PASSWORD,
"""
    cases['all_environment'] = dynamic + '});\n'
    cases['environment_with_timeouts'] = dynamic + ''.join(TIMEOUTS.values()) + '});\n'
    return cases


def run(output, temporary_root):
    summary = {'scanner': 'existing pinned Semgrep Pro / config auto', 'cases': {},
               'missing_cases': [], 'analysis_error_count': 0, 'invalid_metadata': False, 'rule_observed': False}
    with tempfile.TemporaryDirectory(prefix='baci-pg-diagnostic-', dir=temporary_root) as directory:
        root = pathlib.Path(directory).resolve()
        files = []
        for name, source in fixture_cases().items():
            target = root / (name + '.ts')
            target.write_text(source)
            files.append(str(target))
            summary['cases'][name] = {'target_rule_count': 0, 'other_finding_count': 0,
                                      'target_severities': {'INFO': 0, 'WARNING': 0, 'ERROR': 0}}
        raw_path = root / 'raw.json'
        command = ['semgrep', 'scan', '--strict', '--pro-intrafile', '--config', 'auto',
                   '--metrics', 'off', '--json-output', str(raw_path), *files]
        try:
            result = subprocess.run(command, capture_output=True, timeout=300, check=False)
            summary['scanner_exit_code'] = result.returncode
            raw = json.loads(raw_path.read_text())
            if not isinstance(raw, dict):
                raise ValueError('Invalid scanner output')
            paths = raw.get('paths', {})
            scanned_paths = paths.get('scanned', []) if isinstance(paths, dict) else []
            if not isinstance(scanned_paths, list) or any(not isinstance(path, str) for path in scanned_paths):
                raise ValueError('Invalid scanner paths')
            scanned = {str(pathlib.Path(path).resolve()) for path in scanned_paths}
            summary['missing_cases'] = [pathlib.Path(path).stem for path in files if path not in scanned]
            errors = raw.get('errors', [])
            if not isinstance(errors, list):
                raise ValueError('Invalid scanner errors')
            # Count errors without retaining arbitrary scanner/provider metadata.
            summary['analysis_error_count'] = len(errors)
            findings = raw.get('results', [])
            if not isinstance(findings, list):
                raise ValueError('Invalid scanner findings')
            for finding in findings:
                if not isinstance(finding, dict) or not isinstance(finding.get('path'), str):
                    summary['invalid_metadata'] = True
                    continue
                name = pathlib.Path(finding['path']).stem
                if name not in summary['cases']:
                    summary['invalid_metadata'] = True
                    continue
                rule = finding.get('check_id')
                extra = finding.get('extra')
                severity = extra.get('severity') if isinstance(extra, dict) else None
                if not isinstance(rule, str) or not isinstance(severity, str) or severity not in {'INFO', 'WARNING', 'ERROR'}:
                    summary['invalid_metadata'] = True
                    continue
                case = summary['cases'][name]
                if rule == RULE:
                    case['target_rule_count'] += 1
                    case['target_severities'][severity] += 1
                    summary['rule_observed'] = True
                else:
                    case['other_finding_count'] += 1
        except (OSError, ValueError, subprocess.SubprocessError):
            summary['invalid_metadata'] = True
            summary['scanner_exit_code'] = None
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, indent=2) + '\n')
    return 0 if (summary['scanner_exit_code'] == 0 and not summary['analysis_error_count'] and not summary['invalid_metadata']
                 and not summary['missing_cases'] and summary['rule_observed']) else 1


if __name__ == '__main__':
    sys.exit(run(pathlib.Path(sys.argv[1]), pathlib.Path(os.environ['RUNNER_TEMP'])))
