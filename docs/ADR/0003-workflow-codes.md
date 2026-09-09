# ADR 0003 Canonical workflow codes and compatibility aliases

Status: Accepted

Persist the source-of-truth PRD codes `TECHNICAL_REVIEW`, `NEEDS_CORRECTION`, and `EDITORIAL_REVIEW`. At import boundaries only, map `AUTO_CHECK`, `NEEDS_FIX`, and `EDITORIAL_SCREENING` to those canonical codes. Aliases never appear as database states or parallel transitions.

This avoids duplicate semantic states while preserving compatibility with the alternate names in the direct request and orphaned legacy diagram.
