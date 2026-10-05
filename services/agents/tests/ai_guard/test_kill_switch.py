from collections.abc import Callable
from typing import Any

import boto3
import pytest
from botocore.exceptions import EndpointConnectionError
from botocore.stub import Stubber
from types_boto3_ssm import SSMClient

from cv_tailor_agents.ai_guard import AiCallsDisabled
from cv_tailor_agents.ai_guard.kill_switch import CACHE_SECONDS, PARAMETER_NAME, KillSwitch


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


StubValue = Callable[[Stubber, str], None]  # the stub_value fixture in conftest.py


@pytest.fixture
def ssm(session: boto3.Session) -> SSMClient:
    # Fake credentials: Stubber answers every call, so nothing is signed or sent.
    session = boto3.Session(aws_access_key_id="test", aws_secret_access_key="test")
    return session.client("ssm", region_name="us-east-1")


def test_enabled_allows_calls(ssm: SSMClient, stub_value: StubValue) -> None:
    with Stubber(ssm) as stubber:
        stub_value(stubber, "enabled")
        KillSwitch(ssm, FakeClock()).ensure_enabled()
        stubber.assert_no_pending_responses()


@pytest.mark.parametrize("value", ["disabled", "Enabled", "enabled ", "true", "on"])
def test_any_other_value_blocks_calls(ssm: SSMClient, value: str, stub_value: StubValue) -> None:
    with Stubber(ssm) as stubber:
        stub_value(stubber, value)
        with pytest.raises(AiCallsDisabled, match="turned off"):
            KillSwitch(ssm, FakeClock()).ensure_enabled()


@pytest.mark.parametrize(
    "code", ["ParameterNotFound", "AccessDeniedException", "ThrottlingException"]
)
def test_a_missing_or_unreadable_parameter_blocks_calls(ssm: SSMClient, code: str) -> None:
    with Stubber(ssm) as stubber:
        stubber.add_client_error("get_parameter", service_error_code=code)
        with pytest.raises(AiCallsDisabled, match="can't be read"):
            KillSwitch(ssm, FakeClock()).ensure_enabled()


@pytest.mark.parametrize("response", [{}, {"Parameter": {"Name": PARAMETER_NAME}}])
def test_a_response_without_a_value_blocks_calls(ssm: SSMClient, response: dict[str, Any]) -> None:
    with Stubber(ssm) as stubber:
        stubber.add_response("get_parameter", response, {"Name": PARAMETER_NAME})
        with pytest.raises(AiCallsDisabled, match="can't be read"):
            KillSwitch(ssm, FakeClock()).ensure_enabled()


def test_a_network_error_blocks_calls(ssm: SSMClient) -> None:
    def fail(**_: object) -> None:
        raise EndpointConnectionError(endpoint_url="https://ssm.us-east-1.amazonaws.com")

    ssm.meta.events.register("before-call.ssm.GetParameter", fail)
    with pytest.raises(AiCallsDisabled, match="can't be read"):
        KillSwitch(ssm, FakeClock()).ensure_enabled()


def test_a_read_error_is_not_cached(ssm: SSMClient, stub_value: StubValue) -> None:
    switch = KillSwitch(ssm, FakeClock())
    with Stubber(ssm) as stubber:
        stubber.add_client_error("get_parameter", service_error_code="ThrottlingException")
        stub_value(stubber, "enabled")
        with pytest.raises(AiCallsDisabled):
            switch.ensure_enabled()
        switch.ensure_enabled()  # same instant: reads again, and succeeds
        stubber.assert_no_pending_responses()


def test_a_value_is_cached_for_30_seconds_then_read_again(
    ssm: SSMClient, stub_value: StubValue
) -> None:
    clock = FakeClock()
    switch = KillSwitch(ssm, clock)
    with Stubber(ssm) as stubber:
        stub_value(stubber, "enabled")
        stub_value(stubber, "disabled")
        switch.ensure_enabled()
        clock.now += CACHE_SECONDS - 0.001
        switch.ensure_enabled()  # cached: no second read
        clock.now += 0.001
        with pytest.raises(AiCallsDisabled):  # 30 s: reads again and sees the change
            switch.ensure_enabled()
        stubber.assert_no_pending_responses()
