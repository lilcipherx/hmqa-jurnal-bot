# ADR 0007: Shared self-hosted CI runner trust boundary

## Decision

Run repository workflows on the Academy's UpCloud Ubuntu 24.04 x86_64 runner registrations using the required labels `[self-hosted, Linux, X64]`. Each repository has its own runner registration. Checkout disables credential persistence, workflow permissions are minimal, actions are pinned to commit SHA, and production credentials are never supplied to CI.

Untrusted pull requests from forks do not execute on the persistent runner. Job conditions permit push, schedule, and same-repository pull-request events only. Maintainers review fork changes before bringing them onto a trusted branch. The workflows never use `pull_request_target`.

The runtime job creates a unique Docker Compose project and uses only explicitly labelled synthetic test configuration. Cleanup is project-scoped. A failed job must not reuse application containers or data volumes from another run.

## Rationale

The available standard infrastructure is a shared UpCloud X64 host with separate repository runner registrations. Persistent runners require a stricter source trust boundary than disposable hosted runners because a fork can change lifecycle scripts, tests, Dockerfiles, and Compose commands. Refusing automatic fork execution preserves the host while keeping exact Linux/Docker acceptance on the required runner.

## Consequences

Fork contributors need maintainer review before CI execution. Main pushes and same-repository pull requests receive the complete fail-closed quality, database, E2E, runtime, and CodeQL gates. Staging deployment remains separate from the CI trust boundary.
