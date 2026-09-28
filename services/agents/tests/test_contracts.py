from typing import Any

import pytest
from pydantic import ValidationError

from cv_tailor_agents.contracts.health_response import HealthResponse


def test_accepts_valid() -> None:
    assert HealthResponse.model_validate({"status": "ok"}).model_dump() == {"status": "ok"}


@pytest.mark.parametrize(
    ("payload", "error_type"),
    [
        ({"status": "error"}, "literal_error"),  # wrong value
        ({}, "missing"),  # missing field
        ({"status": "ok", "extra": "field"}, "extra_forbidden"),  # unknown key
    ],
)
def test_rejects_invalid(payload: dict[str, Any], error_type: str) -> None:
    with pytest.raises(ValidationError) as exc:
        HealthResponse.model_validate(payload)
    assert exc.value.errors()[0]["type"] == error_type
