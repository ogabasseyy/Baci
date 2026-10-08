import re
import subprocess


SQLSTATE_RE = re.compile(r'^(?:ERROR|FATAL|PANIC):\s*([0-9A-Z]{5})(?::|\s|$)')
SQLSTATE_ALLOWLIST = {
    '08006', '0A000', '22001', '22003', '22023', '22P02', '23502',
    '23503', '23505', '23514', '25P02', '25006', '3F000', '40001',
    '40P01', '42601', '42703', '42704', '42P01', '42P07', '42501',
    '42883', '55000', '55P03', '57014',
}


def _sql_state(stderr):
    if not isinstance(stderr, str):
        return None
    for line in stderr.splitlines():
        match = SQLSTATE_RE.fullmatch(line.strip())
        if match and match.group(1) in SQLSTATE_ALLOWLIST:
            return match.group(1)
    return None


def _unconfirmed(failure, phase, exit_code, timed_out, stderr=''):
    diagnostic = {
        'phase': phase,
        'exitCode': exit_code,
        'timedOut': timed_out,
        'failure': failure,
    }
    sql_state = _sql_state(stderr)
    if sql_state:
        diagnostic['sqlState'] = sql_state
    return {'changesMade': None, 'diagnostic': diagnostic}


def run_apply(sql, runner, command, environment, result_markers):
    try:
        result = runner(
            command, input=sql, text=True, capture_output=True,
            timeout=90, shell=False, env=environment, check=False,
        )
    except subprocess.TimeoutExpired as error:
        return _unconfirmed(
            'timeout', 'subprocess', None, True, error.stderr
        )
    except OSError:
        return _unconfirmed('process-error', 'spawn', None, False)
    if result.returncode != 0:
        return _unconfirmed(
            'nonzero-exit', 'subprocess', result.returncode, False, result.stderr
        )
    lines = result.stdout.splitlines() if isinstance(result.stdout, str) else []
    terminal = lines[-1] if lines else ''
    if terminal not in result_markers:
        return _unconfirmed(
            'unknown-terminal-marker', 'result', result.returncode, False
        )
    return result_markers[terminal]
