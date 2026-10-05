from collections.abc import Callable

import boto3
import pytest
from botocore.stub import Stubber

from cv_tailor_agents.ai_guard.kill_switch import PARAMETER_NAME


@pytest.fixture
def session() -> boto3.Session:
    # Fake credentials: Stubber answers every call, so nothing is signed or sent.
    return boto3.Session(
        aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1"
    )


@pytest.fixture
def stub_value() -> Callable[[Stubber, str], None]:
    def stub(stubber: Stubber, value: str) -> None:
        stubber.add_response(
            "get_parameter",
            {"Parameter": {"Name": PARAMETER_NAME, "Type": "String", "Value": value}},
            {"Name": PARAMETER_NAME},
        )

    return stub
