# ADR-0007: Knowledge Base Store, Bedrock Managed Knowledge Base

| Field       | Value                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status      | Accepted                                                                                                                                                                                                                                                                                 |
| Date        | 2026-10-01                                                                                                                                                                                                                                                                               |
| Amended     | 2026-10-07: what "50 MB" means, the S3 key layout, the presigned upload, and how a reservation is released are recorded (S3-07); 2026-10-07: the knowledge base is defined in OpenTofu, which supports the managed knowledge base (S3-15). The S2-12 results below were checked with CDK |
| Deciders    | Project owner                                                                                                                                                                                                                                                                            |
| Sprint item | S1-13                                                                                                                                                                                                                                                                                    |

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

**"50 MB" is 50,000,000 bytes**, for each file and for the total (S3-07). AWS doesn't say whether the connector's `maxFileSizeInMegaBytes` counts 10^6 or 2^20 bytes per MB. 50,000,000 bytes passes under either reading, so the API never accepts a file that ingestion would skip without saying so. Each candidate can also store at most **100 documents**, which keeps a user's list to one query page and bounds the ingestion work one user can cause.

The S2-12 spike found that the managed S3 connector's own file size filter (`maxFileSizeInMegaBytes`) defaults to 500 MB, while the formats page (source 5) gives 50 MB without saying whether it covers managed knowledge bases. The 50 MB cap holds either way, because it is also the product's limit (KB-03). Sprint 3 enforces it at upload and sets the connector's filter to 50 MB.

### Ingestion settings

Set by the knowledge base stack (S3-06), whose test pins them:

- **File size filter:** the connector skips any file over 50 MB (`maxFileSizeInMegaBytes: "50"`).
- **Media extraction off.** Image, audio, and video extraction are `DISABLED`. No allowed upload type is an image, audio, or video file (KB-03). Image extraction would also read embedded visuals in `.pdf` and `.docx` files, such as a photo on a CV, which is personal data the agents don't need (SAFE-04). The service turns image extraction on by default. The documentation doesn't say whether a scanned, image-only PDF still yields text with it off, so S3-08's live check tests one.
- **Deletion protection off.** With it on, a sync skips its whole delete phase when it would remove more than a set share of the index (15% by default). One knowledge base serves every candidate, so while the index is small, one candidate's delete can pass that share, and the deleted document would stay retrievable. The documents bucket's versioning guards against bulk deletion instead.
- **Default chunking:** fixed size, 300 tokens, 20% overlap. The chunking strategy can't be changed after the data source is created, so a change means a new data source and a full sync.
- **No global ACL file.** Each document's ACL is in its own `<file>.metadata.json`, which the S3 ACL page (source 4) gives as an alternative to the global file.

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

- **Key layout:** a document is at `kb/<sub>/<id>.<ext>`, and its ACL file at `kb/<sub>/<id>.<ext>.metadata.json`. The file's real name is kept in DynamoDB only, so a key holds no personal data and no characters that need escaping. The extension tells ingestion how to parse the file.
- **The API writes the ACL file, never the browser.** `POST /documents` reserves the bytes, writes the ACL file, and only then returns an upload URL, so a document is never in the bucket without its ACL.
- **Presigned PUT, not a presigned POST.** The URL lives for 5 minutes and signs `content-length`, `content-type`, and `x-amz-checksum-sha256`. S3 refuses a body of another size or another SHA-256, so the hash the API stores is the real content's hash. A presigned POST's policy can fix the key and a size range, but tying the content to the declared hash would need a checksum condition we haven't confirmed POST supports. The bucket's CORS allows `PUT` only.
- **Unchanged files are skipped.** An upload whose hash matches one of the same user's stored documents returns "unchanged", because overwriting an unchanged file re-indexes it (S2-12). The check never looks at other users' documents, which would tell one user what another stores.
- **Releasing an upload that never arrived:** a reservation that still has no file in S3 an hour after it was made is released by the next `POST` or `GET /documents` of the same user: its ACL file is deleted, and its item and bytes are freed. The hour is well past the URL's 5 minutes, so a slow upload that started in time isn't released while it's arriving. A stale reservation only blocks its owner, for at most about an hour. A retry of the same file within the hour reuses the reservation with a new URL.
- **Deleting a document** removes the document, then its ACL file, then its item, which frees its bytes. A retry after a failure still finds the item and finishes the job, and the document is never in the bucket without its ACL. A document still uploading can't be deleted until its upload arrives or its hour passes, because a file arriving after its ACL file was deleted would be left in the bucket.
- An upload or a delete starts an ingestion sync through the S3 event (S3-08). Deleting an account removes every document and ACL file, and syncs again.
- The documents bucket is versioned, and old versions expire after 35 days, the same window as the data table's point-in-time recovery. A deleted document can be restored within that window, and is gone for good after it.

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

| Risk                                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The service rejects a synthetic, non-deliverable address as an identity. | The Sprint 2 spike tests it first. The fallback is the verified real email, with ACL files rewritten when a user changes their email, and deleted when the account is deleted. Checked in S2-12: the service accepts it.                                                                                                                                                                                         |
| The backend passes the wrong identity.                                   | One function builds the identity from the verified token, and every Retrieve call goes through it. Tests check that candidate A can't retrieve candidate B's document.                                                                                                                                                                                                                                           |
| A document contains hidden instructions (for example hidden HTML text).  | Retrieved content is untrusted data (SAFE-01), never instructions.                                                                                                                                                                                                                                                                                                                                               |
| CDK has no construct for the managed knowledge base yet.                 | CloudFormation has `AWS::Bedrock::KnowledgeBase` with `ManagedKnowledgeBaseConfiguration`. The Sprint 2 spike confirms the CDK L1 construct supports it; if not, the resource is defined as raw CloudFormation. Checked in S2-12: the L1 construct supports it. Since S3-15 the infrastructure is OpenTofu, and the AWS provider supports it from v6.56.0 ([ADR-0013](0013-infrastructure-as-code-opentofu.md)). |

### When to revisit this decision

- Retrieval quality is not good enough and can't be fixed through the documents or queries: compare a customer-managed knowledge base on S3 Vectors, which gives control over parsing and chunking.
- Per-candidate filtering through ACLs proves fragile: compare one managed knowledge base per candidate (the default quota is 10,000 per account and can be raised).

## Verification

Spike S2-12, in `dev`:

1. `cdk synth` produces a managed knowledge base with an ACL-enabled S3 data source.
2. Two documents are uploaded, each with an ACL for a different synthetic identity, A and B. A Retrieve as A returns only A's document, a Retrieve as B returns only B's, and a Retrieve as an unknown identity returns nothing.
3. A document uploaded without an ACL file is not ingested.

### Results (S2-12, 2026-10-05)

Run in `dev` with the spike stack in `infra/spikes/` and `services/agents/scripts/kb_spike_check.py`. The identities were made-up `sub` values in Cognito's format, and the documents held no personal data.

1. **Pass.** In aws-cdk-lib 2.271.0, the L1 `CfnKnowledgeBase` supports `ManagedKnowledgeBaseConfiguration`. `cdk synth` produced a `MANAGED` knowledge base and a `MANAGED_KNOWLEDGE_BASE_CONNECTOR` S3 data source with `aclEnabled: true`, and CloudFormation deployed both. `connectorParameters` is free-form JSON that neither CloudFormation nor CDK checks before deploy, so a test pins it.
2. **Pass.** The ACLs named `<sub>@users.cv-tailor.invalid`. A Retrieve as A returned only A's document, and a Retrieve as B only B's. An unknown identity, and a request without `userContext`, returned nothing. The service accepts the synthetic identities. A control document for an `example.com` address behaved the same way.
3. **Pass.** The document without an ACL file was never returned, and `ListKnowledgeBaseDocuments` doesn't list it. The first sync counted it in `numberOfDocumentsFailed`. A later sync counted it nowhere, and reported only "The sync completed with partial failures. Some documents could not be crawled." Neither sync named the document.

Observations:

- ACLs took effect as soon as the sync completed: 61 seconds for four small files.
- `userId` matching is case-insensitive.
- Retrieve returns a document's location as `https://<bucket>.s3.amazonaws.com/<key>`, and `ListKnowledgeBaseDocuments` as `s3://<bucket>/<key>`.
- Overwriting an unchanged file re-indexes it, because the object's modified time changes.
- The service stores `connectorParameters` as a JSON string, and adds its defaults: image extraction on, and a 500 MB file size filter.
- Ingestion doesn't name a document it drops for a missing ACL, so the upload must make sure every document has its ACL file.

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

Added by S2-12, accessed 2026-10-05.

9. Create a managed knowledge base: <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-create.html>
10. Service role for managed knowledge bases: <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-permissions.html>
11. ACL-aware retrieval (`userContext`): <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-retrieve-acl.html>
12. Sync a data source: <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-sync.html>

Added by S3-06, accessed 2026-10-06.

13. Amazon S3 connector parameters: <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-s3.html>
14. Connect a data source (media extraction, deletion protection): <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-connect-ds.html>
15. Customize ingestion (chunking can't change after creation): <https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-customize-ingestion.html>
