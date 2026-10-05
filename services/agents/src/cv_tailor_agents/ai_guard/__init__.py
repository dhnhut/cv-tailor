"""The AI call guard (S2-11, ADMIN-03, QUOTA-04). Every paid AI call uses a client from here."""

from cv_tailor_agents.ai_guard.clients import bedrock_runtime_client
from cv_tailor_agents.ai_guard.errors import AiCallBlocked, AiCallRefused, AiCallsDisabled
from cv_tailor_agents.ai_guard.limits import MAX_INPUT_BYTES, MAX_OUTPUT_TOKENS, input_bytes

__all__ = [
    "MAX_INPUT_BYTES",
    "MAX_OUTPUT_TOKENS",
    "AiCallBlocked",
    "AiCallRefused",
    "AiCallsDisabled",
    "bedrock_runtime_client",
    "input_bytes",
]
