"""Complete discovery with explicit retained-native and candidate transitions."""

import json
import re
import time

import replay_quiescence as quiescence
import replay_rehearsal_inventory as inventory
import cutover_runtime as runtime


class StartupInventory(inventory.ReplayRehearsalInventory):
    def __init__(self, callbacks, operator):
        super().__init__(callbacks.inventory_run, callbacks.clock, callbacks.locks_held)
        self.operator = operator
        self.retained = False
        self.candidate_id = None
        self.allow_running = False
        self.candidate_pid = None

    def _containers(self, started):
        identifiers = self._ids(started)
        raw = self._command([*runtime.DOCKER, 'container', 'inspect',
            '--format=' + inventory.FORMAT, *identifiers], started)
        values = [json.loads(line, object_pairs_hook=inventory._unique) for line in raw.splitlines()]
        inventory._require(len(values) == len(identifiers)
            and {value['Id'] for value in values} == set(identifiers)
            and set(self._ids(started)) == set(identifiers))
        witnessed, claimants, unknown = set(), {}, set()
        self.candidate_pid = None
        for value in values:
            identifier, name, state = value['Id'], value['Name'], value['State']
            inventory._require(type(name) is str and re.fullmatch(r'/[a-zA-Z0-9][a-zA-Z0-9_.-]*', name)
                and all(type(state[key]) is bool for key in ('Running', 'Paused', 'Restarting'))
                and type(value['NetworkSettings']['Networks']) is dict)
            networks = value['NetworkSettings']['Networks']
            if identifier in inventory.INFRASTRUCTURE:
                inventory._require(name == inventory.INFRASTRUCTURE[identifier]
                    and inventory.NETWORK in networks and state['Running'] is True
                    and not state['Paused'] and not state['Restarting'])
                witnessed.add(identifier)
            elif identifier in quiescence.CLAIMANTS.values():
                claimant = next(key for key, pin in quiescence.CLAIMANTS.items() if pin == identifier)
                projected = {key: value[key] for key in ('Id', 'Name', 'State', 'HostConfig')}
                if identifier == runtime.NATIVE_ID:
                    expected_name = runtime.RETAINED if self.retained else runtime.CONTAINER
                    inventory._require(name == '/' + expected_name)
                    expected = dict(Running=False, Paused=False, Restarting=False, Dead=False,
                        OOMKilled=False, ExitCode=0, Status='exited', Pid=0)
                    inventory._require(all(type(state[key]) is type(item) and state[key] == item
                        for key, item in expected.items()))
                    quiescence._exact(value['HostConfig']['RestartPolicy'], dict(Name='no', MaximumRetryCount=0))
                    self.operator.inspect(identifier, runtime.NATIVE_ROOT, runtime.NATIVE_SEAL, name=expected_name)
                else:
                    quiescence._container(projected, claimant, identifier)
                claimants[identifier] = projected
            elif identifier == self.candidate_id:
                inventory._require(self.retained and name == '/' + runtime.CONTAINER
                    and not state['Paused'] and not state['Restarting'] and not state['Dead']
                    and not state['OOMKilled'] and (self.allow_running or state['Running'] is False))
                quiescence._exact(value['HostConfig']['RestartPolicy'], dict(Name='no', MaximumRetryCount=0))
                bound = self.operator.inspect(identifier, runtime.CANDIDATE_ROOT,
                    runtime.CANDIDATE_SEAL, name=runtime.CONTAINER)
                inventory._require(bound['State'] == state)
                if state['Running']:
                    inventory._require(type(state['Pid']) is int and state['Pid'] > 1)
                    self.candidate_pid = state['Pid']
                else:
                    inventory._require(type(state['Pid']) is int and state['Pid'] == 0
                        and state['Status'] in ('created', 'exited')
                        and type(state['ExitCode']) is int and state['ExitCode'] == 0)
                claimants[identifier] = value
            elif ((state['Running'] or state['Restarting'] or state['Paused'])
                    and (inventory.NETWORK in networks or inventory.MARKER.search(
                        json.dumps([name, value['Image'], value['Entrypoint'], value['Cmd']])))):
                unknown.add('container:' + identifier)
            elif inventory.MARKER.search(json.dumps([name, value['Image'], value['Entrypoint'], value['Cmd']])):
                quiescence._exact(value['HostConfig']['RestartPolicy'], dict(Name='no', MaximumRetryCount=0))
        expected = set(quiescence.CLAIMANTS.values())
        if self.candidate_id is not None:
            expected.add(self.candidate_id)
        inventory._require(witnessed == set(inventory.INFRASTRUCTURE) and set(claimants) == expected)
        return claimants, unknown

    def _processes(self, started):
        raw = self._command(['/usr/bin/ps', '-eo', 'pid=,ppid=,comm=,args='], started)
        rows = [line.split(None, 3) for line in raw.splitlines()]
        inventory._require(len(rows) <= 4096 and all(len(row) == 4 and row[0].isdigit()
            and row[1].isdigit() for row in rows) and len({row[0] for row in rows}) == len(rows))
        parents = {int(row[0]): int(row[1]) for row in rows}
        inventory._require(all(parents.get(pid) == parent
            for pid, parent in zip(self.driver_ancestry, self.driver_ancestry[1:])))
        owned = set()
        if self.candidate_pid is not None:
            inventory._require(self.candidate_pid in parents)
            owned.add(self.candidate_pid)
            for unused in range(len(rows)):
                expanded = owned | {pid for pid, parent in parents.items() if parent in owned}
                if expanded == owned:
                    break
                owned = expanded
        return {'process:' + row[0] for row in rows if int(row[0]) not in owned
            and int(row[0]) not in self.driver_ancestry and inventory.MARKER.search(row[3])
            and not inventory._stop_only({'ExecStart': 'argv[]=' + row[3] + ' ;'})}

    def sample(self):
        first, started = self._now(), time.monotonic()
        inventory._require(self.locks_held() is True)
        containers, docker_unknown = self._containers(started)
        units, unit_unknown = self._units(started)
        unknown = docker_unknown | unit_unknown | self._processes(started)
        if self.candidate_pid is not None:
            value = self.operator.inspect(self.candidate_id, runtime.CANDIDATE_ROOT,
                runtime.CANDIDATE_SEAL, name=runtime.CONTAINER)
            inventory._require(value['State']['Running'] is True and value['State']['Pid'] == self.candidate_pid)
        last = self._now()
        inventory._require(unknown == set() and self.locks_held() is True
            and 0 <= (last-first).total_seconds() <= 25 and time.monotonic()-started <= 25)
        return dict(observedAt=last.isoformat().replace('+00:00', 'Z'),
            containers=containers, units=units, unknownClaimants=[], exclusive=True)
