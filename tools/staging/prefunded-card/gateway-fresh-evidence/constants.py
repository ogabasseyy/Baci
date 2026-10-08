from pathlib import Path


BINDING = Path('/etc/baci-savings-gateway/binding.json')
EVIDENCE = Path('/etc/baci-savings-gateway/startup-evidence.json')
ROOT = Path('/opt/baci-savings-gateway')
GROUP = 984
BINDING_SHA = '9a917935bf088ee20cddc0179f680c9afc62349bae736f48e6a5d48c85a62ae5'
OLD_SHA = 'c1ad9ba021842fc876094af62f9dd6f463de2d7aeb83337eaa821c3ae59f5ae4'
DEADLINE = '2026-10-06T15:59:10.442Z'
EPOCH = 1791302350
SERVICE = 'baci-savings-gateway.service'
GATEWAY_UNIT_SHA = '8539934f7d9a499e93158388843097cda7c31a398c22df4d8e9a0400170a0bf3'
GRAPH = {
    'compose.mjs': '7e34a257b21c9527d97aaac4ffc3957225b55d3be6e08455bd7b272eba5575dd',
    'managed-files.mjs': 'd9d0c6cbfeddbf6ecd249dd9760d8cd09f38880fdcbefc7a0cdbd79e1553b061',
    'managed-gateway-cli.mjs': '314f63daa895429a5ba4134e2b748edcc5f0c41965a3b6740ce102fd69162866',
    'managed-gateway.mjs': '94f3d2ecbf6b1adc437b84c75afc6b8a921b19d212dcfe34f8625e84bae50825',
    'managed-hosted-draft-renewal-runner.mjs': '7ed6b0159696f0847b040e387ac5057986b4c72a5701f14d83f7612f51274a31',
    'managed-inventory-helper.mjs': 'e78e34607bab7b5eac71878527081f808199e89f999d46c638b5ac298529a80d',
    'managed-private-smoke-runner.mjs': '1deeaaf1d88291d53a720c5666429a8cb6e7983bf534705f1666a1351f3efacf',
    'private-routing-inventory.mjs': 'f8feff6a3b48645f0ae44d25cf1ab18952e0c11510a2aeac2f6f6cd898c4ddbd',
    'private-routing-supervisor-child.py': '6dfdedd0d182d8b836c7a67b30d50c7049e6f7b5272ceb7ba4da507b2723b16d',
    'private-routing-supervisor-inventory.mjs': '6205de16870dfb1e5219df2cafc2fdd6252505d0f3349a1064e0ffe8b49f7781',
    'private-routing.mjs': '8aa326f61e6de815a8cd6a16aca1fbae92eb8db925e0d65dc4b25a93c32a0617',
}
SOURCES = ('owner.py', 'owner_io.py', 'transaction.py', 'constants.py', 'gateway_probe.mjs')
PRESERVED_UNITS = (SERVICE, 'baci-savings-drafts.service', 'baci-savings-funding.service',
    'baci-savings-drafts-deadline.timer', 'baci-savings-drafts-deadline.service',
    'baci-savings-funding-deadline.timer', 'baci-savings-funding-deadline.service')
