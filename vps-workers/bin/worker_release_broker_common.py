"""Shared constants and protocol exception for worker release broker modules."""
MAX_REQUEST_BYTES = 24 * 1024
MAX_REPLY_BYTES = 70 * 1024 * 1024
MAX_ARCHIVE_COMPRESSED_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 100_000
MAX_EXTRACTION_SECONDS = 90
DISPATCHER_TIMEOUT_SECONDS = 360
BROKER_OPERATION_BUDGET_SECONDS = 1_080
BROKER_CLIENT_TIMEOUT_SECONDS = 1_140
BROKER_REQUEST_TIMEOUT_SECONDS = 15
WORKER_ROOT = "/srv/baci-workers"
TRUSTED_NODE = "/usr/bin/node"
TRUSTED_DISPATCHER = "/usr/local/lib/baci-worker-broker/worker-release-broker-dispatch.mjs"
TRUSTED_HEALTH_CHECK = "/usr/local/lib/baci-worker-broker/worker-release-health-check"


class BrokerProtocolError(Exception):
    pass
