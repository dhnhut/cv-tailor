"""Live check for S2-12, the managed knowledge base spike (ADR-0007 verification steps 2-3).

Run from services/agents after `cdk deploy dev-KbSpike`:

    AWS_PROFILE=cvt-dev uv run python scripts/kb_spike_check.py upload
    AWS_PROFILE=cvt-dev uv run python scripts/kb_spike_check.py sync
    AWS_PROFILE=cvt-dev uv run python scripts/kb_spike_check.py retrieve

The identities are made-up subs in Cognito's format, not real users, and the documents hold no
personal data. Each Retrieve costs USD 0.001 (ADR-0007), and `retrieve` makes six.
"""

import argparse
import json
import time
from dataclasses import dataclass

import boto3
from botocore.exceptions import ClientError

from cv_tailor_agents.ai_guard.clients import REGION, default_kill_switch

STACK_NAME = "dev-KbSpike"
IDENTITY_DOMAIN = "users.cv-tailor.invalid"  # ADR-0007
QUERY = "What is the spike codeword?"

# Lowercase UUID v4, the format of a Cognito sub. Made up.
SUB_A = "0f5b8a52-3c1e-4d7a-9b2f-6a1d2c3e4f5a"
SUB_B = "7c9e2d41-8b3a-4f6e-a1d5-2e3f4a5b6c7d"
SUB_NO_ACL = "3b1f6e2a-9d4c-4a8b-b7e1-5c2d8f9a0b1c"
SUB_UNKNOWN = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b"
# A reserved domain with a normal TLD. It tells "the .invalid identity is rejected" apart from
# "the ACL setup is broken".
CONTROL_IDENTITY = "spike-control@example.com"


def identity(sub: str) -> str:
    return f"{sub}@{IDENTITY_DOMAIN}"


@dataclass(frozen=True)
class Document:
    marker: str  # appears only in this document
    key: str
    acl_identity: str | None  # None: no .metadata.json, so it must not be ingested


DOCUMENTS = (
    Document("MARKER-ALPHA", f"kb/{SUB_A}/profile.md", identity(SUB_A)),
    Document("MARKER-BRAVO", f"kb/{SUB_B}/profile.md", identity(SUB_B)),
    Document("MARKER-CONTROL", "kb/control/profile.md", CONTROL_IDENTITY),
    Document("MARKER-NOACL", f"kb/{SUB_NO_ACL}/profile.md", None),
)
MARKERS = tuple(doc.marker for doc in DOCUMENTS)


@dataclass(frozen=True)
class Case:
    name: str
    user_id: str | None  # None: no userContext
    expected: frozenset[str] | None  # markers; None: an observation, not a pass/fail check


CASES = (
    Case("A sees only A's document", identity(SUB_A), frozenset({"MARKER-ALPHA"})),
    Case("B sees only B's document", identity(SUB_B), frozenset({"MARKER-BRAVO"})),
    Case("an unknown identity sees nothing", identity(SUB_UNKNOWN), frozenset()),
    Case("no user context sees nothing", None, frozenset()),
    Case(
        "control sees only its document",
        CONTROL_IDENTITY,
        frozenset({"MARKER-CONTROL"}),
    ),
    Case(
        "observation: A in capitals (is matching case-sensitive?)",
        identity(SUB_A).upper(),
        None,
    ),
)


def body(doc: Document) -> str:
    # Every document has the codeword, so without ACL filtering one query would match them all.
    return (
        f"# Spike profile {doc.marker}\n\n"
        "The spike codeword is ORCHID.\n\n"
        f"This test document belongs to {doc.marker}. It lists TypeScript and AWS experience.\n"
    )


def stack_outputs() -> dict[str, str]:
    cfn = boto3.client("cloudformation", region_name=REGION)
    stack = cfn.describe_stacks(StackName=STACK_NAME)["Stacks"][0]
    return {output["OutputKey"]: output["OutputValue"] for output in stack.get("Outputs", [])}


def upload(outputs: dict[str, str]) -> None:
    s3 = boto3.client("s3", region_name=REGION)
    bucket = outputs["BucketName"]
    for doc in DOCUMENTS:
        # The ACL goes first,
        # as the product's upload will do it: a document is never there without its ACL.
        if doc.acl_identity is not None:
            acl = {
                "metadataAttributes": {},
                "accessControlList": [
                    {"Name": doc.acl_identity, "Type": "USER", "Access": "ALLOW"}
                ],
            }
            s3.put_object(
                Bucket=bucket,
                Key=f"{doc.key}.metadata.json",
                Body=json.dumps(acl).encode(),
                ContentType="application/json",
            )
        s3.put_object(
            Bucket=bucket,
            Key=doc.key,
            Body=body(doc).encode(),
            ContentType="text/markdown",
        )
        print(f"uploaded {doc.key} ({'ACL ' + doc.acl_identity if doc.acl_identity else 'no ACL'})")


def sync(outputs: dict[str, str]) -> None:
    agent = boto3.client("bedrock-agent", region_name=REGION)
    kb_id, ds_id = outputs["KnowledgeBaseId"], outputs["DataSourceId"]
    job = agent.start_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=ds_id)["ingestionJob"]
    started = time.monotonic()

    while job["status"] in {"STARTING", "IN_PROGRESS", "STOPPING"}:
        print(f"  {job['status']} … {time.monotonic() - started:.0f} s", flush=True)
        time.sleep(15)
        job = agent.get_ingestion_job(
            knowledgeBaseId=kb_id, dataSourceId=ds_id, ingestionJobId=job["ingestionJobId"]
        )["ingestionJob"]
    print(f"ingestion {job['status']} after {time.monotonic() - started:.0f} s")
    print(json.dumps(job.get("statistics", {}), indent=2))
    for reason in job.get("failureReasons", []):
        print(f"failure reason: {reason}")
    # Per-document status, if the managed connector supports it. The no-ACL document should be
    # missing, IGNORED, or FAILED with a reason. Whatever happens is recorded.
    try:
        details = agent.list_knowledge_base_documents(knowledgeBaseId=kb_id, dataSourceId=ds_id)
        for detail in details["documentDetails"]:
            print(
                f"{detail['status']:<12} {json.dumps(detail['identifier'])} "
                f"{detail.get('statusReason', '')}"
            )
    except ClientError as error:
        print(f"ListKnowledgeBaseDocuments: {error.response['Error']['Code']}: {error}")


def retrieve(outputs: dict[str, str]) -> int:
    runtime = boto3.client("bedrock-agent-runtime", region_name=REGION)
    switch = default_kill_switch()
    kb_id = outputs["KnowledgeBaseId"]
    failures = 0
    for case in CASES:
        switch.ensure_enabled()  # ADMIN-03: Retrieve is a paid AI call (S2-11 details)
        try:
            if case.user_id is None:
                response = runtime.retrieve(knowledgeBaseId=kb_id, retrievalQuery={"text": QUERY})
            else:
                response = runtime.retrieve(
                    knowledgeBaseId=kb_id,
                    retrievalQuery={"text": QUERY},
                    userContext={"userId": case.user_id},
                )
        except ClientError as error:
            # A ValidationException naming userId means the service rejects the identity format.
            print(f"ERROR {case.name}: {error.response['Error']['Code']}: {error}")
            failures += case.expected is not None
            continue
        results = response["retrievalResults"]
        found = {
            marker
            for result in results
            for marker in MARKERS
            if marker in result.get("content", {}).get("text", "")
        }
        if case.expected is None:
            verdict = "INFO"
        elif found == case.expected:
            verdict = "PASS"
        else:
            verdict, failures = "FAIL", failures + 1
        print(f"{verdict:<5} {case.name}: {sorted(found) or 'nothing'} ({len(results)} chunks)")
        for result in results:
            print(f"        location={json.dumps(result.get('location'))}")
        if "MARKER-NOACL" in found:
            print("FAIL  the document without an ACL was returned (ADR-0007 step 3)")
            failures += 1
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["upload", "sync", "retrieve"])
    args = parser.parse_args()
    outputs = stack_outputs()
    if args.command == "upload":
        upload(outputs)
    elif args.command == "sync":
        sync(outputs)
    else:
        raise SystemExit(1 if retrieve(outputs) else 0)


if __name__ == "__main__":
    main()
