"""S2-11: only ai_guard/clients.py may create a Bedrock client.

The test reads the source, so it catches a client created anywhere in the package, even in code
no test runs. It looks for the two ways to make one: naming a Bedrock data-plane service, as in
boto3.client("bedrock-runtime"), or importing a library that builds its own Bedrock client.
It catches mistakes, not code written to hide a client.
"""

import ast
from pathlib import Path

import pytest

import cv_tailor_agents

PACKAGE = Path(cv_tailor_agents.__file__).parent
GUARD = PACKAGE / "ai_guard" / "clients.py"
MODULES = sorted(path for path in PACKAGE.rglob("*.py") if path != GUARD)

SERVICE_NAMES = frozenset({"bedrock-runtime", "bedrock-agent-runtime"})
LIBRARIES = frozenset({"langchain_aws", "langchain_anthropic", "anthropic"})


def bedrock_clients(source: str) -> list[str]:
    found: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Constant) and node.value in SERVICE_NAMES:
            found.append(f"line {node.lineno}: names {node.value}")
        elif isinstance(node, ast.Import):
            found += [
                f"line {node.lineno}: imports {a.name}"
                for a in node.names
                if a.name.split(".")[0] in LIBRARIES
            ]
        elif isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] in LIBRARIES:
            found.append(f"line {node.lineno}: imports {node.module}")
    return found


@pytest.mark.parametrize("path", MODULES, ids=lambda p: str(p.relative_to(PACKAGE)))
def test_only_the_guard_creates_bedrock_clients(path: Path) -> None:
    assert bedrock_clients(path.read_text()) == []


def test_the_scan_sees_the_real_client() -> None:
    # Proves the detector works on real code, so the test above can't pass by seeing nothing.
    assert bedrock_clients(GUARD.read_text()) != []


@pytest.mark.parametrize(
    "source",
    [
        'import boto3\nboto3.client("bedrock-runtime")',
        'import boto3\nboto3.Session().client(service_name="bedrock-agent-runtime")',
        "from langchain_aws import ChatBedrockConverse",
        "import langchain_aws.chat_models",
        "from anthropic import AnthropicBedrock",
    ],
)
def test_detects_each_way_to_create_a_client(source: str) -> None:
    assert bedrock_clients(source) != []


def test_ignores_prose() -> None:
    assert bedrock_clients('"""Calls use a bedrock-runtime client."""') == []
