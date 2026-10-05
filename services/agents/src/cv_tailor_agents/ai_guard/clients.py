"""The only module that creates Bedrock clients (S2-11). tests/ai_guard/test_boundary.py fails if
any other module creates one.

The guard is a botocore handler on `provide-client-params`, the first event of every API call,
before botocore builds, signs, or sends the request. So it covers every use of the client:
direct calls, streaming, and LangChain's ChatBedrockConverse(client=...) in Sprint 3.
"""

from __future__ import annotations

import functools
from typing import TYPE_CHECKING, Any

import boto3
from botocore.config import Config

from cv_tailor_agents.ai_guard.errors import AiCallRefused
from cv_tailor_agents.ai_guard.kill_switch import KillSwitch
from cv_tailor_agents.ai_guard.limits import check_request

if TYPE_CHECKING:
    from botocore.model import OperationModel
    from types_boto3_bedrock_runtime import BedrockRuntimeClient

REGION = "us-east-1"  # ADR-0002

# The model calls the guard can measure. Every other operation (InvokeModel, ApplyGuardrail,
# CountTokens, ...) is refused until a later item adds it with its own checks.
GUARDED_OPERATIONS = frozenset({"Converse", "ConverseStream"})

# A slow or failing SSM read blocks the AI call quickly instead of hanging it.
_SSM_CONFIG = Config(
    connect_timeout=2, read_timeout=2, retries={"mode": "standard", "max_attempts": 2}
)


@functools.cache
def default_kill_switch() -> KillSwitch:
    """One switch per process, so every client shares its 30-second cache."""
    return KillSwitch(boto3.client("ssm", region_name=REGION, config=_SSM_CONFIG))


def bedrock_runtime_client(
    *, session: boto3.Session | None = None, kill_switch: KillSwitch | None = None
) -> BedrockRuntimeClient:
    """A bedrock-runtime client that checks the caps and the kill switch before every call."""
    client = (session or boto3.Session()).client("bedrock-runtime", region_name=REGION)
    switch = kill_switch or default_kill_switch()

    def guard(params: dict[str, Any], model: OperationModel, **_: Any) -> None:
        if model.name not in GUARDED_OPERATIONS:
            raise AiCallRefused(f"{model.name} isn't allowed through the guard.")
        check_request(params)  # local checks first: a buggy call is refused without an SSM read
        switch.ensure_enabled()

    # The prefix matches every operation: provide-client-params.bedrock-runtime.<Operation>.
    client.meta.events.register("provide-client-params.bedrock-runtime", guard)
    return client
