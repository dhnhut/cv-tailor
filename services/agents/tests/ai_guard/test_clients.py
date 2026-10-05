from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import boto3
import pytest
from botocore.stub import Stubber

from cv_tailor_agents.ai_guard.clients import bedrock_runtime_client, default_kill_switch
from cv_tailor_agents.ai_guard.errors import AiCallRefused, AiCallsDisabled
from cv_tailor_agents.ai_guard.kill_switch import KillSwitch
from cv_tailor_agents.ai_guard.limits import MAX_OUTPUT_TOKENS

if TYPE_CHECKING:
    from types_boto3_bedrock_runtime import BedrockRuntimeClient

StubValue = Callable[[Stubber, str], None]  # the stub_value fixture in conftest.py

CONVERSE_OK: dict[str, Any] = {
    "output": {"message": {"role": "assistant", "content": [{"text": "OK"}]}},
    "stopReason": "end_turn",
    "usage": {"inputTokens": 5, "outputTokens": 1, "totalTokens": 6},
    "metrics": {"latencyMs": 10},
}
CALL: dict[str, Any] = {
    "modelId": "amazon.nova-micro-v1:0",
    "messages": [{"role": "user", "content": [{"text": "Reply with OK."}]}],
    "inferenceConfig": {"maxTokens": 5},
}


@dataclass
class Guarded:
    client: BedrockRuntimeClient  # the guarded client under test
    bedrock: Stubber  # answers Bedrock calls; with nothing queued, no call may get through
    ssm: Stubber  # answers the kill switch's reads


@pytest.fixture
def guarded(session: boto3.Session) -> Iterator[Guarded]:
    ssm = session.client("ssm")
    # A fixed clock is enough: each test gets a new KillSwitch, so no cached value carries over.
    switch = KillSwitch(ssm, clock=lambda: 0.0)
    client = bedrock_runtime_client(session=session, kill_switch=switch)
    with Stubber(ssm) as ssm_stub, Stubber(client) as bedrock_stub:
        yield Guarded(client, bedrock_stub, ssm_stub)
        # Each test used every response it queued.
        ssm_stub.assert_no_pending_responses()
        bedrock_stub.assert_no_pending_responses()


def test_an_allowed_call_reaches_bedrock(guarded: Guarded, stub_value: StubValue) -> None:
    stub_value(guarded.ssm, "enabled")
    guarded.bedrock.add_response("converse", CONVERSE_OK)
    assert guarded.client.converse(**CALL)["output"] == CONVERSE_OK["output"]


@pytest.mark.parametrize("operation", ["converse", "converse_stream"])
def test_switch_off_refuses_before_bedrock(
    guarded: Guarded, stub_value: StubValue, operation: str
) -> None:
    stub_value(guarded.ssm, "disabled")
    # No Bedrock response is queued: had the call got through, Stubber would raise
    # UnStubbedResponseError instead of AiCallsDisabled.
    with pytest.raises(AiCallsDisabled):
        getattr(guarded.client, operation)(**CALL)


def test_unreadable_switch_refuses_before_bedrock(guarded: Guarded) -> None:
    guarded.ssm.add_client_error("get_parameter", service_error_code="ParameterNotFound")
    with pytest.raises(AiCallsDisabled):
        guarded.client.converse(**CALL)


def test_over_cap_is_refused_without_reading_the_switch(guarded: Guarded) -> None:
    over_cap: dict[str, Any] = {**CALL, "inferenceConfig": {"maxTokens": MAX_OUTPUT_TOKENS + 1}}
    # No SSM response is queued either: the cap is checked first.
    with pytest.raises(AiCallRefused, match="maxTokens"):
        guarded.client.converse(**over_cap)


def test_other_operations_are_refused(guarded: Guarded) -> None:
    with pytest.raises(AiCallRefused, match="InvokeModel isn't allowed"):
        guarded.client.invoke_model(modelId="m", body=b"{}")


def test_one_kill_switch_per_process() -> None:
    assert default_kill_switch() is default_kill_switch()
