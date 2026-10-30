"""Shared typed failures for the fixed broker upgrade protocol."""


class BrokerUpgradeRejected(RuntimeError):
    """The broker generation transition did not complete and verify."""


class BrokerUpgradeRecoveryRequired(BrokerUpgradeRejected):
    """The old generation could not be restored and the journal remains active."""


__all__ = ["BrokerUpgradeRecoveryRequired", "BrokerUpgradeRejected"]
