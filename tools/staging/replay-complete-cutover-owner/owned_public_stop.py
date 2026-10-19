"""Bounded fixed-public-unit withdrawal; never starts a service or retries."""

import json
import re
import time

import public_resume as resume


def owned_public_stop(runtime, arguments, timeout, bus, manager):
    runtime.cleanup_requested, runtime.cleanup_confirmed = True, False
    end = time.monotonic() + timeout

    def remaining(limit=1, reserve=0):
        available = end - time.monotonic() - reserve
        resume._require(available > 0)
        return min(limit, available)

    try:
        pending = []
        try:
            pending = runtime.jobs(remaining(1, 8))
        except Exception:
            pass
        if runtime.job is not None and runtime.job in pending:
            try:
                runtime.command([*bus, 'call', *manager, 'CancelJob', 'u', str(runtime.job)], remaining(0.5, 8))
            except Exception:
                pass
        resume._require(runtime.stop_authority(lambda limit: remaining(limit, 8)) is True)
        value = json.loads(runtime.command([
            *bus, 'call', *manager, 'StopUnit', 'ss', resume.SERVICE, 'replace'], remaining(3, 6)))
        resume._require(type(value) is dict and set(value) == {'type', 'data'} and value['type'] == 'o'
            and type(value['data']) is list and len(value['data']) == 1 and type(value['data'][0]) is str)
        match = re.fullmatch('/org/freedesktop/systemd1/job/([1-9][0-9]*)', value['data'][0])
        resume._require(match is not None)
        runtime.stop_job = int(match[1])
        while True:
            pending = runtime.jobs(remaining(1, 6))
            state = runtime.properties(resume.SERVICE, ('ActiveState', 'MainPID'), remaining(1, 6))
            if not pending and state['ActiveState'] in ('inactive', 'failed') and state['MainPID'] == '0':
                break
            time.sleep(remaining(0.1, 6))
    finally:
        runtime.command(arguments, remaining(6))
    resume._require(runtime.jobs(remaining()) == [])
    state = runtime.properties(resume.SERVICE, ('ActiveState', 'MainPID'), remaining())
    resume._require(state['ActiveState'] in ('inactive', 'failed') and state['MainPID'] == '0'
        and time.monotonic() <= end)
    runtime.cleanup_confirmed = True
