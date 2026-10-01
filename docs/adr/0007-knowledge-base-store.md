# ADR-0007: Knowledge Base Store, Bedrock Managed Knowledge Base

| Field       | Value         |
| ----------- | ------------- |
| Status      | Accepted      |
| Date        | 2026-10-01    |
| Deciders    | Project owner |
| Sprint item | S1-13         |

## Context

Each candidate's documents are indexed for retrieval (KB-05), so the agents can find evidence for a job's requirements (`AGENTS.md` §5.3). The project needs a store that indexes those documents and searches them, and a way to make sure one candidate's documents are never returned for another candidate.

The [service availability report](../cloud/service-availability.md) §3.4 compared the vector store options by region and cost. All of them are available in `us-east-1`.

### Decision drivers

1. **No fixed monthly cost** at low traffic.
2. **Little infrastructure to run:** no clusters, no VPC.
3. **Per-candidate isolation:** retrieval returns only the owning candidate's documents.
4. **Supports the file types candidates upload** (KB-03).
5. **Fits AgentCore:** the agents reach the knowledge base through AgentCore Gateway (`AGENTS.md` §5.4).

## Options Considered

### Option A: OpenSearch Serverless

- **Cons:** billed in OCUs with a minimum capacity, so it has a fixed monthly floor even with no traffic.

Rejected, because it fails driver 1.

### Option B: Aurora PostgreSQL with pgvector

- **Pros:** can scale to zero (auto-pause).
- **Cons:** runs in a VPC, storage is always billed, and a cold start takes about 15 seconds, or 30 seconds or more after a day idle.

Rejected, because it fails driver 2.

### Option C: Customer-managed Bedrock knowledge base on S3 Vectors

- **Pros:** pay per use for embeddings, storage, and queries, with no minimum. Full control over the parser, chunking, and embedding model. Metadata filters can limit retrieval to one candidate.
- **Cons:** the embedding model, parser, and chunking have to be chosen and tuned. No agentic retrieval and no AgentCore Gateway integration.

### Option D: Bedrock Managed Knowledge Base (chosen)

- **Pros:** Bedrock runs ingestion, storage, indexing, and retrieval. Parsing, embeddings, and reranking are included at no extra charge. No minimum cost. The only knowledge base type with agentic retrieval and AgentCore Gateway integration. Supports document-level ACLs for an S3 data source.
- **Cons:** less control over parsing and chunking. AWS describes its ACL filtering as "not authorization", so the application must enforce isolation. A newer service (generally available 2026-06-17).

## Decision

**Bedrock Managed Knowledge Base, with an S3 data source and ACL-aware retrieval.**

### File types

Candidates can upload `.txt`, `.md`, `.html`, `.doc`/`.docx`, and `.pdf`, up to **50 MB per file**, which is the knowledge base's own limit. Each candidate can store up to **50 MB in total** (KB-06). A single file at the maximum size fills the whole allowance.

### Isolation model

- ACL awareness is turned on for the S3 data source (`aclEnabled: true`).
- Every document has a `<file>.metadata.json` next to it, with one `ALLOW` entry for its owner. A document without an ACL entry is not ingested, so a missing ACL hides the document instead of exposing it.
- The ACL identity is **a synthetic address built from the candidate's Cognito `sub`** (for example `<sub>@users.cv-tailor.invalid`), not the candidate's real email:
  - The `sub` never changes, so an email change doesn't cut a candidate off from their documents.
  - A `sub` is never reused, so a new account with an old email can't see the old account's documents.
  - The ACL files hold no personal data (SAFE-04).
- **The application is the security boundary.** Only the backend calls Retrieve, and it builds the identity from the verified Cognito token, never from user input. For the personal chatbot (later release), the backend passes the identity of the candidate the chatbot represents.
- Retrieval fails closed: an ACL error returns fewer or no results, never another candidate's documents.

### Upload and delete

- An upload writes the document and its ACL file to S3 together, then starts an ingestion sync.
- Deleting a document, or an account, removes both files and syncs again.

## Consequences

### Positive

- No vector store, cluster, or VPC to run.
- No fixed cost. Storage is USD 5 per GB of raw data per month, and retrieval is USD 1 per 1,000 calls. A candidate at the 50 MB cap costs about USD 0.25 per month in storage.
- The agents can reach the knowledge base through AgentCore Gateway.

### Negative

- Ingestion is a sync job, so a new document is searchable only after the sync finishes. A knowledge base runs at most 50 ingestion jobs at once.
- Parsing and chunking are mostly managed by Bedrock, so retrieval quality is tuned through the documents and queries, not the pipeline.
- Isolation depends on the application always passing the right identity. A bug there could return another candidate's documents.

### Risks and mitigations

| Risk                                                                     | Mitigation                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The service rejects a synthetic, non-deliverable address as an identity. | The Sprint 2 spike tests it first. The fallback is the verified real email, with ACL files rewritten when a user changes their email, and deleted when the account is deleted.                                  |
| The backend passes the wrong identity.                                   | One function builds the identity from the verified token, and every Retrieve call goes through it. Tests check that candidate A can't retrieve candidate B's document.                                          |
| A document contains hidden instructions (for example hidden HTML text).  | Retrieved content is untrusted data (SAFE-01), never instructions.                                                                                                                                              |
| CDK has no construct for the managed knowledge base yet.                 | CloudFormation has `AWS::Bedrock::KnowledgeBase` with `ManagedKnowledgeBaseConfiguration`. The Sprint 2 spike confirms the CDK L1 construct supports it; if not, the resource is defined as raw CloudFormation. |

### When to revisit this decision

- Retrieval quality is not good enough and can't be fixed through the documents or queries: compare a customer-managed knowledge base on S3 Vectors, which gives control over parsing and chunking.
- Per-candidate filtering through ACLs proves fragile: compare one managed knowledge base per candidate (the default quota is 10,000 per account and can be raised).

## Verification

Spike S2-08, in `dev`:

1. `cdk synth` produces a managed knowledge base with an ACL-enabled S3 data source.
2. Two documents are uploaded, each with an ACL for a different synthetic identity, A and B. A Retrieve as A returns only A's document, a Retrieve as B returns only B's, and a Retrieve as an unknown identity returns nothing.
3. A document uploaded without an ACL file is not ingested.

## Sources

Accessed 2026-10-01.

1. Build a managed knowledge base: <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-build-managed.html>
2. Service quotas for managed knowledge bases: <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-quotas.html>
3. ACL awareness for managed knowledge bases: <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-acl.html>
4. Document-level access controls for Amazon S3: <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-s3-acl.html>
5. Supported document formats and limits: <https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-ds.html>
6. Amazon Bedrock pricing (Managed Knowledge Base): <https://aws.amazon.com/bedrock/pricing/>
7. CloudFormation `ManagedKnowledgeBaseConfiguration`: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-bedrock-knowledgebase-managedknowledgebaseconfiguration.html>
8. Managed Knowledge Base launch announcement: <https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-managed-knowledge-base/>
