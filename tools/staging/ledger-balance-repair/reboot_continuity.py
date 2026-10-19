import json
from pathlib import Path


PREVIOUS_BOOT = 'c2fd1cd1-6737-4bfb-815c-37dab031efe2'
CURRENT_BOOT = 'bd2e42c2-e580-4ca2-a556-ef2183f6c7e1'
INVOCATION = 'eeb9e601eecf4ae2809090523a2d4958'
WORKER = '3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4'
UNIT = 'baci-prefunded-background.service'
CURRENT_UNIT = dict(LoadState='loaded', ActiveState='inactive', SubState='dead',
    Result='success', ExecMainStatus='0', InvocationID='', DropInPaths='',
    NeedDaemonReload='no', MainPID='0', ExecMainPID='0',
    ExecMainStartTimestamp='', ExecMainExitTimestamp='')
FAILED_STATE = dict(Status='exited', Running=False, Paused=False, Restarting=False,
    OOMKilled=False, Dead=False, Pid=0, ExitCode=1, Error='',
    StartedAt='2026-10-03T11:35:34.525281484Z',
    FinishedAt='2026-10-03T11:35:35.378946867Z')


def require(condition):
    if not condition:
        raise ValueError('ledger_reboot_continuity_refused')


def verify(value):
    require(type(value) is dict and set(value) == {'boot', 'unit', 'worker', 'journal'}
        and value['boot'] == CURRENT_BOOT and value['unit'] == CURRENT_UNIT
        and value['worker'] == dict(id=WORKER, state=FAILED_STATE, restartCount=0))
    require(type(value['worker']['restartCount']) is int and all(
        type(value['worker']['state'][name]) is type(expected)
        for name, expected in FAILED_STATE.items()))
    rows = value['journal']
    require(type(rows) is list and 0 < len(rows) <= 64 and all(
        type(row) is dict and row.get('_BOOT_ID') == PREVIOUS_BOOT.replace('-', '')
        and row.get('_SYSTEMD_INVOCATION_ID') == INVOCATION for row in rows))
    return dict(value['unit'])


def install(diagnostic):
    require(diagnostic.WORKER == WORKER and diagnostic.DEADLINE == '2026-10-06T15:59:10Z')

    def current_unit():
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        command = ['/usr/bin/systemctl', 'show', UNIT, '--no-pager']
        for name in CURRENT_UNIT:
            command.extend(('-p', name))
        state = diagnostic.run(command)
        require(state.returncode == 0 and not state.stderr and len(state.stdout) <= 8192)
        fields = state.stdout.splitlines()
        require(len(fields) == len(CURRENT_UNIT) and all('=' in line for line in fields))
        unit = dict(line.split('=', 1) for line in fields)
        worker = diagnostic.inspect(WORKER)
        journal = diagnostic.run(['/usr/bin/journalctl', '--no-pager', '--output=json',
            '_SYSTEMD_INVOCATION_ID=' + INVOCATION])
        require(journal.returncode == 0 and not journal.stderr and len(journal.stdout) <= 65536)
        rows = [json.loads(line) for line in journal.stdout.splitlines()]
        result = verify(dict(boot=boot, unit=unit, worker=dict(id=worker['Id'],
            state=worker['State'], restartCount=worker['RestartCount']), journal=rows))
        require(Path('/proc/sys/kernel/random/boot_id').read_text().strip() == boot)
        return result

    diagnostic.worker_unit = current_unit
    return diagnostic
