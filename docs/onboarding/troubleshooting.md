# Troubleshooting

Problems you may meet, and how to fix them. Read the whole error message first: it usually names the file or the setting at fault. If nothing here helps after 30 minutes, ask your mentor ([Getting help](README.md#getting-help)).

## Setup

| Symptom                                                                  | Cause and fix                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The dev container doesn't start, and the log mentions `.aws` or a mount  | The folder `~/.aws` doesn't exist on your computer. Run `mkdir -p ~/.aws` on your computer, not in the container, then **Dev Containers: Rebuild Container**. |
| `Cannot connect to the Docker daemon` when the container is built        | Docker isn't running on your computer. Start Docker Desktop, OrbStack, or the Docker service, then try again.                                                 |
| The build stops at a checksum line from `install-iac-tools.sh`           | A download failed or changed. Rebuild once. If it fails again, tell your mentor. Never change the hashes yourself: they are what makes the download safe.     |
| On Windows, the build is very slow or file changes aren't noticed        | The repository is on the Windows file system. Clone it inside WSL 2 and open it from there.                                                                   |
| `pnpm: command not found`, or a pnpm version other than `package.json`'s | Corepack isn't turned on. Run `corepack enable`, then `pnpm -v` again.                                                                                        |
| The terminal shows `%` or `➜` instead of `$`, and a command fails oddly  | The terminal is zsh, and the guide's commands are for bash. Type `bash` first.                                                                                |

## Checks

| Symptom                                                                          | Cause and fix                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run check` fails at `lint:workflows` with a Docker error                   | `actionlint` runs in Docker inside the container, and Docker there isn't running. Rebuild the container. If it still fails, tell your mentor.                                                                                                                 |
| `prettier --check` lists a file with `[warn]`                                    | The file isn't formatted. Run `pnpm run format`, then look at the change with `git diff`.                                                                                                                                                                     |
| The first `pnpm run check` fails while downloading providers, plugins, or images | It needs internet. Check your connection and run it again. If the TFLint plugin download is refused by GitHub's rate limit, run `export GITHUB_TOKEN=$(gh auth token)` first.                                                                                 |
| A test you didn't touch fails                                                    | Check `git status` for changes you forgot. Then try on an up-to-date `main` (`git switch main && git pull --ff-only`). If `main` fails too, it isn't your change: tell your mentor.                                                                           |
| `pnpm test -- <file>` fails the coverage gate                                    | The gate counts the whole package, so one file is below 80%. From the package's folder, run `pnpm exec vitest run <file>` instead ([`packages/config/README.md`](../../packages/config/README.md#vitest-coverage)).                                           |
| `pnpm run contracts:check` says the generated contracts are out of date          | A contract changed without `pnpm run generate`, or the generated files aren't staged. Module 05 explains both.                                                                                                                                                |
| `pnpm install` changed `pnpm-lock.yaml`, and you didn't mean to add a package    | Undo it with `git restore pnpm-lock.yaml` and run `pnpm install` again. Never add a package for one project with `pnpm --filter … add` without asking: see the S2-10 lesson in the [Sprint 2 review](../sprints/sprint-02-walking-skeleton.md#sprint-review). |
| VS Code shows a TypeScript error, but `pnpm --filter <package> typecheck` passes | VS Code's TypeScript server is out of date. Command Palette → **TypeScript: Restart TS Server** (S2-12 lesson).                                                                                                                                               |

## The web app

| Symptom                                               | Cause and fix                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The page says "CV Tailor couldn't start."             | `/config.json` didn't load from `dev`: no internet, or `dev` is down. Open `https://dev.cv.ikiwii.com/config.json` in your browser. If it doesn't load, tell your mentor. |
| Sign-in shows a Cognito error page about the redirect | You opened `127.0.0.1`, or Vite is on a port other than 5173. Use exactly `http://localhost:5173`. See [03 Setup](03-setup.md#6-run-the-web-app-dev-sign-in).             |
| Vite says port 5173 is in use and picks 5174          | Another dev server is still running. Stop it with Ctrl+C in its terminal, then start again.                                                                               |
| The verification email doesn't arrive                 | Check your spam folder. The `dev` user pool sends at most 50 emails a day for everyone, so ask your mentor before you try again.                                          |

## Git

| Symptom                                                  | Cause and fix                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `git pull` refuses because you have changes              | Your working tree isn't clean. Commit your changes on a branch, or undo them with `git restore`, then pull again.               |
| You committed to `main` by mistake                       | Don't push. Create a branch from where you are (`git switch -c <branch>`), then ask your mentor how to reset your local `main`. |
| `git log` fills the screen and doesn't return            | It opened a pager. Press `q` to quit.                                                                                           |
| `git push` is rejected on your own branch after a rebase | A rebase rewrites your commits. Push with `git push --force-with-lease`, on your own branch only (module 13).                   |

## Claude Code

| Symptom                                                | Cause and fix                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The Tutor style isn't in the list                      | The file must be `~/.claude/output-styles/tutor.md` inside the container. Restart Claude Code, because it reads styles when it starts. After a rebuild, create it again. |
| Claude edits a file                                    | Check that `.claude/settings.local.json` is at the repository root, and that it is valid JSON. Then tell your mentor.                                                    |
| `.claude/settings.local.json` shows up in `git status` | Your branch is older than the rule in `.gitignore`. Start your branch from an up-to-date `main`.                                                                         |

## Lessons from past sprints

Every sprint review ends with "Lessons learned": real problems this project hit, and what fixed them. When something strange happens, search the sprint docs for a word from your error message, for example:

```bash
grep -rn "timeout" docs/sprints/
```

- [Sprint 0](../sprints/sprint-00-foundation.md#sprint-review)
- [Sprint 1](../sprints/sprint-01-deployable-foundation.md#sprint-review)
- [Sprint 2](../sprints/sprint-02-walking-skeleton.md#sprint-review)
- [Sprint 3](../sprints/sprint-03-knowledge-base-and-first-agent.md#sprint-review)
