"""One stock-psql connection for sealed SQL and private precommit inspection.

This transport grants no SQL execution authority. Its caller must authenticate
the command, sources and database identity before using it. A failed frame or
commit acknowledgement is unconfirmed, never permission to retry a mutation.
"""

import os
import selectors
import signal
import subprocess
import time
import uuid


class PsqlTransaction:
    def __init__(self, command, *, timeout=60, output_limit=4000000, lifetime=180):
        if not isinstance(command, list) or not command or not all(
            type(item) is str and item and '\x00' not in item for item in command):
            raise ValueError('psql_transaction_unconfirmed')
        if not 0 < timeout <= 60 or not 0 < lifetime <= 180 or not 80 <= output_limit <= 16000000:
            raise ValueError('psql_transaction_unconfirmed')
        self.timeout, self.output_limit = timeout, output_limit
        self.expires = time.monotonic() + lifetime
        self.commit_attempted = self.commit_acknowledged = self.closed = False
        self.cleanup_confirmed = False
        self.process = self.selector = None
        environment = {name: os.environ[name] for name in ('PATH', 'HOME') if name in os.environ}
        environment.update(LANG='C', LC_ALL='C')
        try:
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, env=environment, start_new_session=True)
            self.selector = selectors.DefaultSelector()
            for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
                os.set_blocking(stream.fileno(), False)
            self.selector.register(self.process.stdout, selectors.EVENT_READ, 'stdout')
            self.selector.register(self.process.stderr, selectors.EVENT_READ, 'stderr')
        except BaseException as failure:
            self.close()
            if isinstance(failure, (KeyboardInterrupt, SystemExit)):
                raise
            raise ValueError('psql_transaction_unconfirmed') from None

    def execute(self, source):
        try:
            if self.closed or type(source) is not str or not source.strip() or '\x00' in source:
                raise ValueError('psql_transaction_unconfirmed')
            marker = 'PVB_TRANSACTION_FRAME_' + uuid.uuid4().hex
            wire = ("\\set ON_ERROR_STOP on\n" + source + "\nSELECT '" + marker + "';\n").encode('utf-8')
            if len(wire) > 4000000:
                raise ValueError('psql_transaction_unconfirmed')
            self.selector.register(self.process.stdin, selectors.EVENT_WRITE, 'stdin')
            end = min(self.expires, time.monotonic() + self.timeout)
            offset, total, stdout = 0, 0, bytearray()
            records = []
            while True:
                remaining = end - time.monotonic()
                if remaining <= 0:
                    raise ValueError('psql_transaction_unconfirmed')
                events = self.selector.select(remaining)
                if not events:
                    raise ValueError('psql_transaction_unconfirmed')
                for key, _ in events:
                    if key.data == 'stdin':
                        offset += os.write(key.fd, wire[offset:offset + 65536])
                        if offset == len(wire):
                            self.selector.unregister(self.process.stdin)
                        continue
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        self.selector.unregister(key.fileobj)
                        if key.data == 'stdout':
                            raise ValueError('psql_transaction_unconfirmed')
                        continue
                    total += len(chunk)
                    if total > self.output_limit:
                        raise ValueError('psql_transaction_unconfirmed')
                    if key.data == 'stderr':
                        continue
                    stdout.extend(chunk)
                    while b'\n' in stdout:
                        line, _, tail = stdout.partition(b'\n')
                        stdout = bytearray(tail)
                        decoded = line.decode('utf-8')
                        if decoded == marker:
                            if offset != len(wire) or stdout:
                                raise ValueError('psql_transaction_unconfirmed')
                            return records
                        if decoded:
                            records.append(decoded)
        except BaseException as failure:
            self.close()
            if isinstance(failure, (KeyboardInterrupt, SystemExit)):
                raise
            raise ValueError('psql_transaction_unconfirmed') from None

    def finish(self, *, commit):
        try:
            if type(commit) is not bool or self.closed:
                raise ValueError('psql_transaction_unconfirmed')
            if commit:
                if self.execute("DO $assigned_transaction$ BEGIN IF "
                    "pg_catalog.pg_current_xact_id_if_assigned() IS NULL THEN "
                    "RAISE EXCEPTION 'assigned transaction required' USING ERRCODE='42501'; "
                    'END IF; END $assigned_transaction$;'):
                    raise ValueError('psql_transaction_unconfirmed')
            self.commit_attempted = commit
            terminal = 'COMMIT' if commit else 'ROLLBACK'
            if self.execute('\\set QUIET off\n' + terminal + ';\n\\set QUIET on') != [terminal]:
                raise ValueError('psql_transaction_unconfirmed')
            self.process.stdin.close()
            if self.process.wait(timeout=2) != 0:
                raise ValueError('psql_transaction_unconfirmed')
            self.commit_acknowledged = commit
            self.close()
        except BaseException as failure:
            self.close()
            if isinstance(failure, (KeyboardInterrupt, SystemExit)):
                raise
            raise ValueError('psql_transaction_unconfirmed') from None

    def close(self):
        if self.closed:
            if not self.cleanup_confirmed:
                raise ValueError('psql_transaction_unconfirmed')
            return
        self.closed = True
        failures = []

        def attempt(action, default=None):
            try:
                return action()
            except Exception:
                failures.append(True)
                return default

        if self.selector is not None:
            attempt(self.selector.close)
        if self.process is None:
            self.cleanup_confirmed = not failures
        else:
            attempt(self.process.stdin.close)
            attempt(lambda: self._wait_process(0.2))
            for value, duration in ((signal.SIGTERM, 0.3), (signal.SIGKILL, 1)):
                if not attempt(self._group_gone, False):
                    attempt(lambda: self._signal_group(value))
                    attempt(lambda: self._wait_group(duration))
                if attempt(self.process.poll) is None:
                    attempt(self.process.terminate if value == signal.SIGTERM else self.process.kill)
                    attempt(lambda: self._wait_process(duration))
            attempt(lambda: self._wait_process(1))
            group_gone = attempt(self._group_gone, False)
            reaped = attempt(self.process.poll) is not None
            attempt(self.process.stdout.close)
            attempt(self.process.stderr.close)
            self.cleanup_confirmed = group_gone and reaped and not failures
        if not self.cleanup_confirmed:
            raise ValueError('psql_transaction_unconfirmed') from None

    def _wait_process(self, duration):
        try:
            self.process.wait(timeout=duration)
        except subprocess.TimeoutExpired:
            pass

    def _signal_group(self, value):
        try:
            os.killpg(self.process.pid, value)
        except ProcessLookupError:
            pass

    def _group_gone(self):
        self.process.poll()
        try:
            os.killpg(self.process.pid, 0)
            return False
        except ProcessLookupError:
            return True
        except PermissionError:
            try:
                result = subprocess.run(['/bin/ps', '-axo', 'pgid='], capture_output=True,
                    text=True, timeout=2, check=True)
                groups = result.stdout.split()
                if not groups or not all(value.isdecimal() for value in groups):
                    raise ValueError('psql_transaction_unconfirmed')
                return str(self.process.pid) not in groups
            except Exception:
                raise ValueError('psql_transaction_unconfirmed') from None

    def _wait_group(self, duration):
        end = time.monotonic() + duration
        while not self._group_gone() and time.monotonic() < end:
            self.process.poll()
            time.sleep(0.01)
