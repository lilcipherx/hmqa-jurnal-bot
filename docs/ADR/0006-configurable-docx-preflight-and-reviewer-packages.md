# ADR 0006: Configurable DOCX preflight and reviewer packages

Status: Accepted technical default; journal-specific thresholds remain subject to Academy approval.

## Context

The PRD requires explainable DOCX checks, rendered page evidence, immutable rule/tool versions, and reviewer access only to an anonymized derivative. It also leaves the authoritative renderer, severity thresholds, and blind-review model open per journal.

## Decision

- Store DOCX rules in each immutable journal requirement version rather than in worker code.
- Inspect bounded OOXML parts for A4 geometry, margins, default font/size, line spacing, and required markers.
- Render page count with headless LibreOffice in an isolated temporary profile. The worker container is read-only, capability-free, resource-limited, and has only a bounded tmpfs plus the quarantine volume.
- Record counts and finding codes, but never manuscript excerpts, in preflight evidence.
- Let authorized journal-scoped editorial staff upload a separately prepared DOCX/PDF reviewer package. It enters the same quarantine, signature, ClamAV, and private-S3 pipeline and never replaces the author original.
- Require explicit manual-anonymization attestation. PF-015 checks DOCX body/core/custom properties for exact known author identifier classes and always requires manual verification. Only identifier class names and counts are persisted.

## Consequences

LibreOffice pagination is reproducible within a pinned image but may differ from Microsoft Word, so page-count tolerance/severity cannot be published until the journal owner approves them. Automated anonymization detection is a guardrail rather than proof; the Academy must approve the blind-review procedure and accountable role.
