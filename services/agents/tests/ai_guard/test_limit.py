from typing import Any

import pytest

from cv_tailor_agents.ai_guard import (
    MAX_INPUT_BYTES,
    MAX_OUTPUT_TOKENS,
    AiCallRefused,
    input_bytes,
)
from cv_tailor_agents.ai_guard.limits import check_request


def request(text: str = "hi", max_tokens: object = 100, **extra: Any) -> dict[str, Any]:
    return {
        "modelId": "model",
        "messages": [{"role": "user", "content": [{"text": text}]}],
        "inferenceConfig": {"maxTokens": max_tokens},
        **extra,
    }


@pytest.mark.parametrize("max_tokens", [1, MAX_OUTPUT_TOKENS])
def test_accepts_max_tokens_within_the_cap(max_tokens: int) -> None:
    check_request(request(max_tokens=max_tokens))


@pytest.mark.parametrize("max_tokens", [0, -1, MAX_OUTPUT_TOKENS + 1])
def test_refuses_max_tokens_outside_the_cap(max_tokens: int) -> None:
    with pytest.raises(AiCallRefused, match="maxTokens is"):
        check_request(request(max_tokens=max_tokens))


@pytest.mark.parametrize("max_tokens", [None, "100", True, 100.0])
def test_refuses_max_tokens_that_isnt_an_integer(max_tokens: object) -> None:
    with pytest.raises(AiCallRefused, match="must be set"):
        check_request(request(max_tokens=max_tokens))


@pytest.mark.parametrize("params", [{"modelId": "m"}, {"modelId": "m", "inferenceConfig": {}}])
def test_refuses_a_call_without_max_tokens(params: dict[str, Any]) -> None:
    with pytest.raises(AiCallRefused, match="must be set"):
        check_request(params)


def test_input_at_the_cap_is_accepted_and_one_byte_more_is_refused() -> None:
    room = MAX_INPUT_BYTES - input_bytes(request(text=""))
    check_request(request(text="a" * room))
    with pytest.raises(AiCallRefused, match=f"{MAX_INPUT_BYTES + 1} bytes"):
        check_request(request(text="a" * (room + 1)))


def test_counts_utf8_bytes_not_characters() -> None:
    assert input_bytes("é") == 2
    assert input_bytes("日本") == 6
    assert input_bytes("🙂") == 4


def test_counts_keys_numbers_and_every_section() -> None:
    assert input_bytes({"system": [{"text": "abc"}]}) == len("system") + len("text") + 3
    assert input_bytes({"n": 1234, "ok": True, "none": None}) == 1 + 4 + 2 + 4 + 4


@pytest.mark.parametrize("block", ["image", "document", "video"])
def test_refuses_blocks_it_cant_measure(block: str) -> None:
    content = [{block: {"format": "png", "source": {"s3Location": {"uri": "s3://b/k"}}}}]
    with pytest.raises(AiCallRefused, match=f"'{block}' block"):
        check_request({**request(), "messages": [{"role": "user", "content": content}]})


@pytest.mark.parametrize("value", [b"raw", bytearray(b"raw"), {"a-set"}])
def test_refuses_values_it_cant_measure(value: object) -> None:
    with pytest.raises(AiCallRefused, match="can't be measured"):
        input_bytes({"x": value})


def test_refusal_messages_hold_no_request_content() -> None:  # SAFE-04
    with pytest.raises(AiCallRefused) as exc:
        check_request(request(text="secret " * MAX_INPUT_BYTES))
    assert "secret" not in str(exc.value)
