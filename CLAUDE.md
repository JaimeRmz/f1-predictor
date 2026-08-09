# f1-predictor — working agreements

## Deploy topology (verified 2026-08-09 against the Vercel API, not inferred)

| | |
|---|---|
| Frontend host | Vercel, project `f1-predictor` (`prj_65lbaV54tJhNa5eVlzKZWs3E4ixA`), team `jaime-codes` |
| Git connection | GitHub `JaimeRmz/f1-predictor`, **connected** |
| Production branch | `main` |
| Auto-deploy on push | **Enabled** (`gitProviderOptions.createDeployments = "enabled"`) |
| Ignored Build Step | none set |
| Root Directory | `frontend` (Vite) |
| Production domains | `f1predictor.app`, `f1-predictor-wheat.vercel.app` |
| Backend host | Render (`render.yaml`, service `f1-predictor-api`, rootDir `backend`) |

**Any commit pushed to `main` deploys straight to production at f1predictor.app.**
There is no staging gate. Pushing a branch other than `main` produces a preview
deployment only, which is safe to share.

`render.yaml` does not set `autoDeploy: false`, so the backend is expected to
redeploy on pushes to its connected branch as well. That one is inferred from
the blueprint — it has not been confirmed against the Render API.

## Branch policy

Do **not** commit or push directly to `main`.

For any visual, structural, or experimental change:

1. Create a feature branch (`feat/…`, `fix/…`, `style/…`, `exp/…`).
2. Commit and push there. Share the Vercel preview URL for review.
3. Stop. Merging is a separate step.

Merge to `main` **only** when Jaime has explicitly said he is ready to ship
that specific work. "Looks good", "nice", or approval of a preview is *not*
a merge instruction — ask, or wait for an explicit go-ahead.

A `PreToolUse` hook in `.claude/settings.json` prompts for confirmation on any
command that would push, merge, or force-push into `main`. Treat that prompt as
a checkpoint, not an obstacle to route around.

## Commits

Do not add a `Co-Authored-By` trailer.
