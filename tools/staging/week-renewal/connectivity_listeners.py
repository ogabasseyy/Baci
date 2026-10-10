import re

from renewal_contract import Refused


def validate_listeners(content, processes):
    seen = set()
    for line in content.splitlines():
        fields = line.split()
        if len(fields) < 6 or fields[0] != 'LISTEN':
            raise Refused('connectivity-listener-shape')
        address = re.fullmatch(r'127\.0\.0\.1:(4792|4795)', fields[3])
        pids = re.findall(r'pid=([0-9]+)', line)
        if address is None or len(pids) != 1:
            raise Refused('connectivity-listener-authority')
        port = int(address[1])
        if port in seen or processes.get(port) != int(pids[0]):
            raise Refused('connectivity-listener-authority')
        seen.add(port)
    if seen != set(processes) or seen != {4792, 4795}:
        raise Refused('connectivity-listener-missing')
