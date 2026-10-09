# 03 Setup

**Time:** 4 hours, including the first container build · **Week:** 1 · **Safety:** `[No AWS]`, then `[Dev sign-in]` · **Last checked:** 2026-10-09, `2e9e051`

## Goal

Run the whole project on your computer and see every check pass. You need no AWS access for any of it.

## Before you start

- macOS or Linux. On Windows, install WSL 2 and do everything inside it, including cloning the repository: the dev container needs a Linux home folder.
- Installed on your computer: Git; Docker (Docker Desktop, OrbStack on macOS, or Docker Engine on Linux); and VS Code with the **Dev Containers** extension.
- A GitHub account with two-factor authentication turned on.
- [00 Rules](00-rules.md) read.

## Learn first

- [Developing inside a container](https://code.visualstudio.com/docs/devcontainers/containers), up to the quick start.
- [02 Learning path](02-learning-path.md): 1 (terminal) and 15 (dev containers).

## Steps

### 1. Prepare your computer

Run these on your computer, not in a container:

```bash
mkdir -p ~/.aws
git config --global user.name "Your Name"
git config --global user.email "<your GitHub noreply address>"
```

- **Why `~/.aws`:** the dev container shares this folder with your computer (`mounts` in `.devcontainer/devcontainer.json`). If the folder doesn't exist, the container won't start. It stays empty until week 3.
- **Why a noreply address:** the repository is public, so the email in your commits is public too. Find your noreply address on GitHub under **Settings → Emails**, with **Keep my email addresses private** turned on.

### 2. Clone the repository

```bash
git clone https://github.com/dhnhut/cv-tailor.git
cd cv-tailor
code .
```

### 3. Open it in the dev container

In VS Code, open the Command Palette (Ctrl+Shift+P, or Cmd+Shift+P on macOS) and choose **Dev Containers: Reopen in Container**. The first build downloads images and every tool, so it is slow. Later starts reuse them and are fast.

While you wait, read [`.devcontainer/devcontainer.json`](../../.devcontainer/devcontainer.json) and [`.devcontainer/postCreate.sh`](../../.devcontainer/postCreate.sh):

- The container gets Node.js 24, Python 3.12, the AWS CLI, Docker, and the GitHub CLI (`features`).
- `postCreate.sh` turns on pnpm through Corepack and installs uv. Then it installs OpenTofu, TFLint, and Trivy with `install-iac-tools.sh`, which checks every download against a fixed SHA-256 hash.
- Finally it installs the project's packages: `pnpm install` for TypeScript and `uv sync` for Python.

Expected: the build's terminal ends with `==> Dev container ready`.

The commands in this guide are for **bash**. If your terminal shows a zsh prompt, type `bash` first.

### 4. Check the tools `[No AWS]`

Open a terminal in VS Code (Terminal → New Terminal). It runs inside the container.

```bash
node -v; pnpm -v; python3 --version; uv --version; tofu version; tflint --version; trivy --version
```

Expected:

| Tool                    | Expected                      | Where the version is set                                                         |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Node.js                 | `v24.x`, at least `v24.16`    | `engines` in [`package.json`](../../package.json)                                |
| pnpm                    | `12.5.1`                      | `packageManager` in [`package.json`](../../package.json)                         |
| Python                  | `3.12.x`                      | `services/agents/.python-version`                                                |
| uv                      | a recent version              | not pinned                                                                       |
| OpenTofu, TFLint, Trivy | `v1.13.1`, `0.64.0`, `0.75.0` | [`.devcontainer/install-iac-tools.sh`](../../.devcontainer/install-iac-tools.sh) |

The files are the truth. If they say something different from this table, the guide is out of date: tell your mentor.

### 5. Run every check `[No AWS]`

```bash
time pnpm run check; echo "exit code: $?"
```

This runs the same checks as CI:

1. Prettier checks that every file is formatted.
2. `actionlint` checks the GitHub workflows. It runs in Docker.
3. Every package runs lint, typecheck, test with an 80% coverage gate, and build.

The first run also downloads OpenTofu providers and lint plugins, so it needs internet and is slower. Later runs take a minute or two. You'll see a lot of output, including coverage tables.

Expected: the last line is `exit code: 0`, which means every check passed.

Then check the generated contracts (module 05 explains them):

```bash
pnpm run contracts:check
```

Expected: the last line is `✅ Generated contracts are up to date.`

```bash
git status
```

Expected: `nothing to commit, working tree clean`. The checks write only to folders git ignores, such as `coverage/` and `dist/`.

### 6. Run the web app `[Dev sign-in]`

```bash
pnpm --filter @cv-tailor/web dev
```

Expected: Vite prints a `Local:` address on port `5173`. Open **http://localhost:5173**, exactly that address, in your browser.

- **What runs on your computer:** only the web app. Vite forwards `/config.json` and the API calls to the deployed `dev` environment (`proxy` in [`apps/web/vite.config.ts`](../../apps/web/vite.config.ts)). So you need internet, and you sign in to `dev`'s real user pool.
- **Why `localhost` and not `127.0.0.1`:** sign-in sends you to Amazon Cognito and back. Cognito returns only to addresses registered in `infra/modules/settings/main.tf`, and for local work that is `http://localhost:5173` alone. `127.0.0.1` is the same computer, but a different address to Cognito, so it refuses. For the same reason, if Vite moves to port 5174 because 5173 is busy, sign-in breaks.

Ask your mentor first, then sign up with an email address you control. Cognito emails you a verification code. The user pool sends at most 50 emails a day for everyone, so sign up once.

Expected: after you sign in, **Your profile** shows your **Email**, a **User ID**, and **Role: Candidate**. Copy your User ID into `notes.local/`: you'll find it in the database in week 3.

Stop the server with Ctrl+C.

### 7. Sign in to GitHub from the container

```bash
gh auth login
```

Choose GitHub.com, HTTPS, and log in with a web browser. Expected: `gh auth status` says you're logged in. You need this from module 11.

### 8. Set up your AI tutor

Follow [00 Rules: Your AI tutor](00-rules.md#your-ai-tutor) with your mentor.

## Verify

- `pnpm run check` ends with exit code 0.
- `pnpm run contracts:check` prints the ✅ line.
- You signed in at `http://localhost:5173` and saw your profile.
- `gh auth status` says you're logged in.

## Check your understanding

1. Why must you open `http://localhost:5173`, and not `http://127.0.0.1:5173`?

   <details>
   <summary>Answer</summary>

   Cognito sends people back only to addresses that are registered exactly. For local work, only `http://localhost:5173` is registered (`local_web_origin` in `infra/modules/settings/main.tf`).

   </details>

2. Where does the web app on your computer get its settings and its data?

   <details>
   <summary>Answer</summary>

   From the deployed `dev` environment. Vite forwards `/config.json` to `https://dev.cv.ikiwii.com`, and the API paths such as `/me` to `https://api.dev.cv.ikiwii.com`. There is no local API or database.

   </details>

3. What does `pnpm run check` run?

   <details>
   <summary>Answer</summary>

   Prettier on every file, actionlint on the workflows (in Docker), then lint, typecheck, test with an 80% coverage gate, and build in every package. `tasks` in `pnpm-workspace.yaml` sets the order.

   </details>

4. Why does the container need `~/.aws` on your computer?

   <details>
   <summary>Answer</summary>

   `devcontainer.json` mounts it into the container, so an AWS sign-in on your computer also works in the container, and the other way round. Mounting a folder that doesn't exist fails, so the container doesn't start.

   </details>

## If you get stuck

See [troubleshooting: setup](troubleshooting.md#setup) and [troubleshooting: the web app](troubleshooting.md#the-web-app).
