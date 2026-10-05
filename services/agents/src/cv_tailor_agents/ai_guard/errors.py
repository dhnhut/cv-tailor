"""Errors the AI call guard raises.
Messages hold names and numbers, never request content (SAFE-04)."""


class AiCallBlocked(Exception):
    """The guard stopped an AI call before it reached AWS."""


class AiCallsDisabled(AiCallBlocked):
    """The kill switch is off or can't be read. Not a bug: callers tell the user AI is paused."""


class AiCallRefused(AiCallBlocked):
    """The call breaks a cap or uses an operation the guard doesn't allow. A bug in the caller."""
