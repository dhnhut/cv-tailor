"""Live check for S2-11. Sends a tiny Converse call through the guard every few seconds, so you
can flip the kill switch and watch calls stop and start. Each allowed call costs a fraction of a
cent: 5 output tokens on Amazon Nova Micro.

    AWS_PROFILE=cvt-dev uv run python scripts/ai_guard_check.py --minutes 3
    AWS_PROFILE=cvt-dev uv run python scripts/ai_guard_check.py --once --prompt-file README.md
"""

import argparse
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from cv_tailor_agents.ai_guard import AiCallBlocked, bedrock_runtime_client, input_bytes

# The cheapest text model. It's served in us-east-1 without a cross-region profile. This isn't a
# model choice for the product (D-09).
MODEL_ID = "amazon.nova-micro-v1:0"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minutes", type=float, default=2.0)
    parser.add_argument("--every", type=float, default=5.0)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--prompt-file", type=Path)
    args = parser.parse_args()

    text = args.prompt_file.read_text() if args.prompt_file else "Reply with OK."
    call: dict[str, Any] = {
        "modelId": MODEL_ID,
        "messages": [{"role": "user", "content": [{"text": text}]}],
        "inferenceConfig": {"maxTokens": 5},
    }
    client = bedrock_runtime_client()
    end = time.monotonic() + args.minutes * 60
    while True:
        stamp = datetime.now(UTC).strftime("%H:%M:%S")
        try:
            usage = client.converse(**call)["usage"]
            print(
                f"{stamp} allowed  bytes={input_bytes(call)} "
                f"inputTokens={usage['inputTokens']} outputTokens={usage['outputTokens']}"
            )
        except AiCallBlocked as error:
            print(f"{stamp} blocked  {type(error).__name__}: {error}")
        if args.once or time.monotonic() >= end:
            break
        time.sleep(args.every)


if __name__ == "__main__":
    main()
