# API conventions

Interactive OpenAPI is served at `/documentation`; the generated JSON is available at `/documentation/json`. Internal Telegram service routes are intentionally hidden from the public specification. The full-stack acceptance probe verifies the OpenAPI version, public route inventory, staff-cookie security scheme, and absence of internal routes.

## Authentication

Staff APIs use the opaque `hmqa_session` HttpOnly cookie. Every state-changing browser request also requires the matching `x-csrf-token` and exact `Origin`. Internal bot calls require `x-hmqa-service-secret`. File objects are never proxied as public bucket URLs; an authorized request returns a short-lived signed URL.

Every request accepts a UUID `x-request-id`; invalid/missing values are replaced. The API echoes the validated/generated value in the response `x-request-id` header, and error envelopes, logs, metrics labels, status/audit events use the same request correlation context.

## Error envelope

```json
{
  "code": "VALIDATION_ERROR",
  "messageKey": "validation.required",
  "correlationId": "00000000-0000-4000-8000-000000000000",
  "fieldErrors": []
}
```

Clients localize `messageKey`; sensitive exception text is never returned. Validation is normally `422`, unauthenticated requests `401`, authorization/scope failures `403`, missing resources `404`, and concurrency/guard failures `409`.

## Main staff resources

- `/api/v1/auth/*`: login, logout, current session, staff invitation enrollment;
- `/api/v1/admin/journals*` and `/requirements*`: journal catalog and version lifecycle;
- `/api/v1/admin/submissions*`: pagination, detail, assignments, messages, decision proposals, and controlled transitions;
- `/api/v1/admin/reviews*`: administrator-managed reviewer response and review recording;
- `/api/v1/admin/files/:id/download`: authorized signed download;
- `/api/v1/internal/telegram/users/:telegramUserId/files/:fileId/download`: service-authenticated, owner-bound author signed download;
- `/api/v1/internal/telegram/users/:telegramUserId/submissions/:submissionId/receipt`: latest-version receipt status and owner-bound signed PDF download;
- `/api/v1/admin/employees*`, `/roles`: administrator identity/security management (`/roles` exposes only `ADMIN`); `/reviewers`: standalone reviewer directory;
- `/api/v1/admin/translations*`: versioned localized template lifecycle;
- `/api/v1/admin/notifications*`: delivery state and dead-letter replay;
- `/api/v1/admin/reports*`, `/audit`, `/settings/runtime`: reporting and operations.

List endpoints use bounded `limit` values and cursor pagination where the data set is unbounded. Mutations with concurrent edits require `expectedRowVersion` or `expectedUpdatedAt` and fail closed on stale values.
