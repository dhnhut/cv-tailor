"""Per-call caps (QUOTA-04). Pure functions, no AWS.

Output: every call sets inferenceConfig.maxTokens to at most MAX_OUTPUT_TOKENS. A call that asks
for more is refused, not reduced, because it is a bug.

Input: measured in UTF-8 bytes of every key and string in the request. Bedrock's CountTokens is
exact, but not every model supports it and it adds a round trip to each call. Bytes are local,
instant, and work for any model. With byte-level BPE tokenizers a token covers at least one byte,
so bytes over-count text tokens (English is about 4 bytes per token). Image, document, and video
blocks can't be measured this way, so they're refused until a later item decides how to count them.
"""

from collections.abc import Mapping

from cv_tailor_agents.ai_guard.errors import AiCallRefused

MAX_OUTPUT_TOKENS = 4_096
MAX_INPUT_BYTES = 100_000

# Converse content blocks whose size isn't in their text. A tool input key with one of these
# names is refused too; that's fail closed, and no tool uses them yet.
_UNMEASURED_BLOCKS = frozenset({"image", "document", "video"})


def check_request(params: Mapping[str, object]) -> None:
    """Raise AiCallRefused if a Converse or ConverseStream request breaks a cap."""
    _check_max_tokens(params.get("inferenceConfig"))
    size = input_bytes(params)
    if size > MAX_INPUT_BYTES:
        raise AiCallRefused(f"Input is {size} bytes; the cap is {MAX_INPUT_BYTES}.")


def input_bytes(value: object) -> int:
    """UTF-8 bytes of every key and value, walking dicts and lists. Refuses what it can't size."""
    if isinstance(value, str):
        return len(value.encode())
    if isinstance(value, bool | int | float):
        return len(str(value))
    if value is None:
        return 0
    if isinstance(value, Mapping):
        total = 0
        for key, item in value.items():
            if key in _UNMEASURED_BLOCKS:
                raise AiCallRefused(f"A '{key}' block can't be measured, so it's refused.")
            total += input_bytes(key) + input_bytes(item)
        return total
    if isinstance(value, list | tuple):
        return sum(input_bytes(item) for item in value)
    # bytes (inline images or documents), sets, and custom objects
    raise AiCallRefused(f"A {type(value).__name__} value can't be measured, so it's refused.")


def _check_max_tokens(config: object) -> None:
    max_tokens = config.get("maxTokens") if isinstance(config, Mapping) else None
    # bool is a subclass of int, so True would otherwise pass as 1.
    if not isinstance(max_tokens, int) or isinstance(max_tokens, bool):
        raise AiCallRefused("inferenceConfig.maxTokens must be set to an integer.")
    if not 1 <= max_tokens <= MAX_OUTPUT_TOKENS:
        raise AiCallRefused(f"maxTokens is {max_tokens}; it must be 1 to {MAX_OUTPUT_TOKENS}.")
