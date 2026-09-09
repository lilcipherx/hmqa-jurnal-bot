# Security policy

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials, personal data, manuscripts, or exploit details in a public issue or pull request. Use the repository's **Security → Report a vulnerability** private reporting flow on GitHub. If private reporting is unavailable, contact the repository owner through a private channel before sharing details.

Include the affected commit, impact, minimal reproduction, and suggested mitigation. Use synthetic data only. Do not test against Academy or production infrastructure without explicit written authorization.

## Supported versions

Until the first signed release, only the current `main` branch is maintained. A green CI run is not production approval; deployment also requires the documented staging, backup/restore, security, and Academy UAT gates.

## Secrets and sensitive data

Production secrets belong in the deployment secret manager, never Git, GitHub Actions variables visible to forks, images, fixtures, logs, or issue content. Test fixtures use reserved domains and explicitly synthetic credentials. If a secret is exposed, revoke it first, then remove it from all reachable Git history and repeat the public repository audit.

The engineering security model is documented in [docs/SECURITY.md](docs/SECURITY.md).
