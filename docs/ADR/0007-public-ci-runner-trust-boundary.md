# ADR 0007: Public CI runner trust boundary

## Decision

Run public-repository CI on disposable GitHub-hosted Ubuntu 24.04 runners with top-level `contents: read` permission. Do not execute pull-request code on a persistent self-hosted runner. Do not use `pull_request_target`. Checkout disables credential persistence, actions are pinned to commit SHA, and fork/Dependabot jobs receive no project secrets.

The runtime job starts its own isolated Docker Compose project and uses only the explicitly labelled test configuration. Production credentials are never required by CI.

## Rationale

A public fork can change application code, package lifecycle behavior, tests, Dockerfiles, and Compose commands. Running that code on a shared persistent runner would expose the runner host and any residual credentials. Disposable hosted runners provide the required Linux/Docker boundary without trusting contributor code.

## Consequences

CI usage is subject to GitHub-hosted runner availability and limits. Staging deployment remains a separate, explicitly authorized workflow and must not be added to the pull-request trust boundary.
