# CV Tailor

An AI application that writes a tailored CV and cover letter for a specific job, using only facts from the candidate's own documents. A candidate builds a personal knowledge base once. A multi-agent system on AWS Bedrock AgentCore then writes job-specific documents in the candidate's own tone. A public chatbot lets headhunters ask about the candidate and check job fit.

> **Status:** Sprint 0 (foundation) is done. The repository builds, lints, and tests in CI. Feature work starts in later sprints. See [`docs/sprints/`](docs/sprints/).

## Architecture

| Layer     | Technology                                                  |
| --------- | ----------------------------------------------------------- |
| Frontend  | Vite, React, TypeScript, Tailwind CSS, served by CloudFront |
| Backend   | Node.js 24, TypeScript, AWS Lambda, API Gateway             |
| AI agents | Python 3.12, LangChain, LangGraph on Bedrock AgentCore      |
| Data      | DynamoDB, S3, Cognito                                       |
| Infra     | AWS CDK, deployed by GitHub Actions, region `us-east-1`     |

The full scope, agent design, safety requirements, and architecture are in [`AGENTS.md`](AGENTS.md).

## Repository layout

```text
apps/web/            React SPA
apps/api/            Lambda handlers
services/agents/     Python agent service (uv)
packages/contracts/  Zod contracts → JSON Schema → Pydantic
packages/config/     Shared ESLint, tsconfig, and Prettier config
infra/               CDK app
docs/                ADRs, sprints, cloud report, runbooks
scripts/             Repo scripts
```

## Quick start

The easiest setup is the devcontainer: open the repo in VS Code and choose **Reopen in Container**. It installs Node.js 24, pnpm (through Corepack), Python 3.12, uv, and all dependencies.

Without the devcontainer, you need Node.js 24 with Corepack enabled, and uv:

```bash
corepack enable
pnpm install
(cd services/agents && uv sync)
```

Common commands, from the repo root:

| Task                                           | Command                     |
| ---------------------------------------------- | --------------------------- |
| Lint, typecheck, test, and build every package | `pnpm run check`            |
| Regenerate the contracts                       | `pnpm run generate`         |
| Check the generated contracts are committed    | `pnpm run contracts:check`  |
| Format every file                              | `pnpm run format`           |
| Test one package                               | `pnpm --filter <name> test` |

## Documentation

- [`AGENTS.md`](AGENTS.md): product scope, requirements, and architecture
- [`docs/adr/`](docs/adr/): architecture decision records
- [`docs/sprints/`](docs/sprints/): sprint plans and reviews
- [`docs/cloud/service-availability.md`](docs/cloud/service-availability.md): AWS service availability report

## License

See [LICENSE](LICENSE).
