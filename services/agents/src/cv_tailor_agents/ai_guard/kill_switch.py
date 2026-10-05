"""The kill switch (ADMIN-03): an SSM parameter that turns off every AI call.

Fail closed: only the exact value "enabled" allows calls. Any other value, a missing parameter,
or a read error blocks them. A value read successfully is cached for 30 seconds, so a change
takes effect within 30 seconds. A read error isn't cached, so the next call tries again.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

from cv_tailor_agents.ai_guard.errors import AiCallsDisabled

if TYPE_CHECKING:
    from types_boto3_ssm import SSMClient

# Created by infra/lib/kill-switch-stack.ts (KILL_SWITCH_PARAMETER).
PARAMETER_NAME = "/cv-tailor/ai-calls"
ENABLED = "enabled"
CACHE_SECONDS = 30.0

logger = logging.getLogger(__name__)


class KillSwitch:
    """Reads the switch, with a cache. When the cache expires, two threads may both read SSM.
    That is harmless, so there is no lock."""

    def __init__(self, ssm: SSMClient, clock: Callable[[], float] = time.monotonic) -> None:
        self._ssm = ssm
        self._clock = clock
        self._value: str | None = None
        self._read_at = 0.0

    def ensure_enabled(self) -> None:
        """Return if AI calls are on. Otherwise raise AiCallsDisabled."""
        if self._read() != ENABLED:
            raise AiCallsDisabled("AI calls are turned off by the kill switch.")

    def _read(self) -> str:
        now = self._clock()
        if self._value is not None and now - self._read_at < CACHE_SECONDS:
            return self._value
        self._value = None  # a failed read below must not leave an old value cached
        try:
            parameter = self._ssm.get_parameter(Name=PARAMETER_NAME).get("Parameter")
        except Exception as error:  # any failure (AWS error, timeout) blocks calls
            logger.warning("Kill switch unreadable; blocking AI calls.", exc_info=True)
            raise AiCallsDisabled(
                "The kill switch can't be read, so AI calls are blocked."
            ) from error
        # The SDK types mark Parameter and Value as optional, so a response without them is
        # treated as a read error, not as a value.
        value = parameter.get("Value") if parameter else None
        if value is None:
            logger.warning("Kill switch response has no value; blocking AI calls.")
            raise AiCallsDisabled("The kill switch can't be read, so AI calls are blocked.")
        self._value, self._read_at = value, now
        return value
