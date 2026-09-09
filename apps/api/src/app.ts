import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { GetObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  journalRequirementConfigSchema,
  orcidSchema,
  transitionRequestSchema,
} from '@hmqa/contracts';
import type { AppConfig } from '@hmqa/config';
import { serializableTransactionWithRetry, transitionSubmission } from '@hmqa/database';
import type { DatabaseClient, Prisma } from '@hmqa/database';
import {
  TransitionDeniedError,
  canTransitionPrivacyRequest,
  hasPermission,
  hasJournalScope,
  permissionsFor,
  submissionStatuses,
  type Role,
  type ScopedActor,
} from '@hmqa/domain';
import { normalizeLocale, placeholders, translate, type Locale } from '@hmqa/i18n';
import { createLogger } from '@hmqa/logger';
import { jobNames, queueDefaults, queueNames, redisConnectionFromUrl } from '@hmqa/shared';
import {
  decryptSecret,
  constantTimeEqual,
  encryptSecret,
  generateTotpSecret,
  generateOpaqueToken,
  hashPassword,
  hashOpaqueToken,
  maskEmail,
  maskPhone,
  sanitizeFileName,
  verifyPassword,
  verifyTotp,
} from '@hmqa/security';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { z } from 'zod';
import * as Sentry from '@sentry/node';

const loginSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1).max(256),
    totp: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    ),
  })
  .strict();

const staffStepUpSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    currentTotp: z.string().regex(/^\d{6}$/),
    confirmation: z.literal(true),
  })
  .strict();

const totpEnrollmentTtlMs = 10 * 60_000;

const submissionResultSchema = z.object({
  submissionId: z.uuid(),
  publicId: z.string(),
  status: z.string(),
  submittedAt: z.coerce.date(),
  receiptJobId: z.uuid(),
});

const hydratedDraftInclude = {
  files: {
    where: { replacedAt: null },
    include: { file: true },
    orderBy: { createdAt: 'desc' },
  },
  preflightRuns: { orderBy: { createdAt: 'desc' } },
  requirementVersion: { include: { localizations: true } },
  journal: {
    include: {
      localizations: true,
      currentRequirement: { include: { localizations: true } },
    },
  },
} satisfies Prisma.DraftInclude;

function fileExtension(fileName: string): string | null {
  const match = /\.([a-z0-9]{1,16})$/i.exec(fileName);
  return match?.[1]?.toLowerCase() ?? null;
}

class BusinessRuleError extends Error {
  constructor(
    readonly code: string,
    readonly messageKey: string,
    readonly statusCode: 409 | 422 = 409,
  ) {
    super(code);
  }
}

const rolePriority: readonly Role[] = [
  'CHIEF_EDITOR',
  'EDITOR',
  'OPERATOR',
  'REVIEWER',
  'CONTENT_ADMIN',
  'ADMIN',
  'AUDITOR',
  'AUTHOR',
];

interface AppDependencies {
  readonly config: AppConfig;
  readonly database: DatabaseClient;
  readonly redis: Redis;
}

function databaseLocale(locale: Locale) {
  return locale === 'uz-Latn' ? ('uz_Latn' as const) : locale;
}

function publicLocale(locale: 'uz_Latn' | 'ru' | 'en'): Locale {
  return locale === 'uz_Latn' ? 'uz-Latn' : locale;
}

function requestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return z.uuid().safeParse(candidate).success ? candidate! : randomUUID();
}

export async function createApp({
  config,
  database,
  redis,
}: AppDependencies): Promise<FastifyInstance> {
  const logger: FastifyBaseLogger = createLogger('api', config.NODE_ENV, config.LOG_LEVEL);
  const app = Fastify({
    loggerInstance: logger,
    genReqId: (request) => requestId(request.headers['x-request-id']),
    trustProxy: true,
    bodyLimit: 1_048_576,
    requestTimeout: 15_000,
  });
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );

  app.decorateRequest('actor', null);
  app.decorateRequest('actorLocale', 'uz-Latn');
  app.decorateRequest('sessionId', null);

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"] },
    },
  });
  await app.register(cors, {
    origin: config.ADMIN_BASE_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: config.FILE_MAX_BYTES,
      files: 1,
      fields: 0,
      parts: 1,
      headerPairs: 50,
      fieldNameSize: 100,
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 180,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.actor?.id ?? request.ip,
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'HMQA JURNAL BOT API', version: '1.0.0' },
      servers: [{ url: config.APP_BASE_URL }],
      components: {
        securitySchemes: { staffCookie: { type: 'apiKey', in: 'cookie', name: 'hmqa_session' } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/documentation', staticCSP: true });

  const metrics = new Registry();
  collectDefaultMetrics({ register: metrics, prefix: 'hmqa_api_' });
  const requestDuration = new Histogram({
    name: 'hmqa_api_request_duration_seconds',
    help: 'API request duration',
    labelNames: ['method', 'route', 'status_code'],
    registers: [metrics],
  });
  const authDenied = new Counter({
    name: 'hmqa_api_auth_denied_total',
    help: 'Denied staff authentication or authorization attempts',
    labelNames: ['reason'],
    registers: [metrics],
  });
  const fileQueue = new Queue(queueNames.fileIngest, {
    connection: redisConnectionFromUrl(config.REDIS_URL),
    defaultJobOptions: queueDefaults,
  });
  const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  app.addHook('onClose', async () => {
    await fileQueue.close();
    s3.destroy();
  });

  app.addHook('onRequest', (request, reply, done) => {
    request.actorLocale = normalizeLocale(request.headers['accept-language']);
    reply.header('x-request-id', request.id);
    (request as FastifyRequest & { requestStartedAt?: bigint }).requestStartedAt =
      process.hrtime.bigint();
    done();
  });
  app.addHook('onResponse', async (request, reply) => {
    const started = (request as FastifyRequest & { requestStartedAt?: bigint }).requestStartedAt;
    if (!started) return;
    requestDuration.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unknown',
        status_code: String(reply.statusCode),
      },
      Number(process.hrtime.bigint() - started) / 1_000_000_000,
    );
  });

  async function authenticateStaff(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies.hmqa_session;
    if (!token) {
      authDenied.inc({ reason: 'missing_session' });
      return reply.code(401).send({
        code: 'UNAUTHENTICATED',
        messageKey: 'error.forbidden',
        correlationId: request.id,
      });
    }
    const session = await database.staffSession.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: {
        employee: {
          include: { roles: { include: { role: true } }, journalScopes: true },
        },
      },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.lastSeenAt <= new Date(now.getTime() - config.SESSION_IDLE_MINUTES * 60_000) ||
      session.employee.status !== 'ACTIVE'
    ) {
      authDenied.inc({ reason: 'invalid_session' });
      return reply.code(401).send({
        code: 'UNAUTHENTICATED',
        messageKey: 'error.forbidden',
        correlationId: request.id,
      });
    }
    const roleCodes = session.employee.roles
      .filter((membership) => !membership.expiresAt || membership.expiresAt > now)
      .map((membership) => membership.role.code as Role);
    const role = rolePriority.find((candidate) => roleCodes.includes(candidate));
    if (!role)
      return reply
        .code(403)
        .send({ code: 'FORBIDDEN', messageKey: 'error.forbidden', correlationId: request.id });
    request.actor = {
      id: session.employee.id,
      role,
      journalIds: new Set(
        session.employee.journalScopes
          .filter((scope) => !scope.expiresAt || scope.expiresAt > now)
          .map((scope) => scope.journalId),
      ),
      stepUpVerified: Boolean(session.stepUpUntil && session.stepUpUntil > now),
    };
    request.sessionId = session.id;
    await database.staffSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }

  async function authenticateService(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const supplied = request.headers['x-hmqa-service-secret'];
    if (typeof supplied !== 'string' || !constantTimeEqual(supplied, config.SERVICE_AUTH_SECRET)) {
      authDenied.inc({ reason: 'service_auth' });
      await reply.code(401).send({
        code: 'UNAUTHENTICATED',
        messageKey: 'error.forbidden',
        correlationId: request.id,
      });
    }
  }

  async function verifyCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.sessionId) {
      await reply.code(401).send({
        code: 'UNAUTHENTICATED',
        messageKey: 'error.forbidden',
        correlationId: request.id,
      });
      return;
    }
    const csrf = request.headers['x-csrf-token'];
    const origin = request.headers.origin;
    if (typeof csrf !== 'string' || origin !== config.ADMIN_BASE_URL) {
      authDenied.inc({ reason: 'csrf' });
      await reply
        .code(403)
        .send({ code: 'CSRF_INVALID', messageKey: 'error.forbidden', correlationId: request.id });
      return;
    }
    const session = await database.staffSession.findUnique({
      where: { id: request.sessionId },
      select: { csrfHash: true },
    });
    if (!session || hashOpaqueToken(csrf) !== session.csrfHash) {
      authDenied.inc({ reason: 'csrf' });
      await reply
        .code(403)
        .send({ code: 'CSRF_INVALID', messageKey: 'error.forbidden', correlationId: request.id });
    }
  }

  async function verifyStaffStepUpCredentials(
    employeeId: string,
    currentPassword: string,
    currentTotp: string,
  ): Promise<boolean> {
    const employee = await database.employee.findUnique({
      where: { id: employeeId },
      select: {
        status: true,
        passwordHash: true,
        totpEnabled: true,
        totpSecretCipher: true,
      },
    });
    if (
      !employee ||
      employee.status !== 'ACTIVE' ||
      !employee.passwordHash ||
      !employee.totpEnabled ||
      !employee.totpSecretCipher
    )
      return false;
    const passwordOk = await verifyPassword(employee.passwordHash, currentPassword);
    let totpOk = false;
    try {
      totpOk = verifyTotp(
        decryptSecret(employee.totpSecretCipher, config.ENCRYPTION_KEY),
        currentTotp,
      );
    } catch {
      totpOk = false;
    }
    return passwordOk && totpOk;
  }

  async function rejectInvalidLogin(
    employeeId: string,
    request: FastifyRequest,
    reply: FastifyReply,
    recordFailure = true,
  ) {
    if (recordFailure)
      await database.$transaction(async (tx) => {
        const failed = await tx.employee.update({
          where: { id: employeeId },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        });
        if (failed.failedLoginCount >= 5) {
          await tx.employee.update({
            where: { id: employeeId },
            data: { lockedUntil: new Date(Date.now() + 15 * 60_000) },
          });
        }
      });
    authDenied.inc({ reason: 'login' });
    return reply.code(401).send({
      code: 'INVALID_CREDENTIALS',
      messageKey: 'error.forbidden',
      correlationId: request.id,
    });
  }

  async function telegramUser(telegramUserId: string) {
    return database.user.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } });
  }

  function draftContext(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : {};
  }

  function requiredContextString(
    context: Record<string, Prisma.JsonValue>,
    key: string,
    max = 10_000,
  ): string {
    const value = context[key];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max)
      throw new Error(`DRAFT_FIELD_INVALID:${key}`);
    return value.trim();
  }

  function optionalContextString(
    context: Record<string, Prisma.JsonValue>,
    key: string,
    max: number,
  ): string | null {
    const value = context[key];
    if (value === undefined || value === null || value === '-') return null;
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max)
      throw new BusinessRuleError('DRAFT_FIELD_INVALID', 'validation.required', 422);
    return value.trim();
  }

  function requirePermission(
    actor: ScopedActor,
    permission: Parameters<typeof hasPermission>[1],
  ): void {
    if (!hasPermission(actor.role, permission))
      throw new TransitionDeniedError('FORBIDDEN', [permission]);
  }

  async function appendAudit(
    tx: Prisma.TransactionClient,
    request: FastifyRequest,
    input: {
      action: string;
      entity: string;
      entityId?: string;
      journalId?: string;
      before?: unknown;
      after?: unknown;
      actor?: {
        type: 'USER' | 'EMPLOYEE' | 'SERVICE' | 'SYSTEM';
        id?: string;
        role?: string;
      };
    },
  ) {
    const actor =
      input.actor ??
      (request.actor
        ? { type: 'EMPLOYEE' as const, id: request.actor.id, role: request.actor.role }
        : undefined);
    if (!actor) throw new Error('AUDIT_ACTOR_REQUIRED');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4815162342)`;
    const previous = await tx.auditLog.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { eventHash: true },
    });
    const safeBefore =
      input.before === undefined
        ? undefined
        : (JSON.parse(JSON.stringify(input.before)) as Prisma.InputJsonValue);
    const safeAfter =
      input.after === undefined
        ? undefined
        : (JSON.parse(JSON.stringify(input.after)) as Prisma.InputJsonValue);
    const eventHash = hashOpaqueToken(
      JSON.stringify({
        previous: previous?.eventHash ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        journalId: input.journalId ?? null,
        actorType: actor.type,
        actorId: actor.id ?? null,
        requestId: request.id,
        before: safeBefore ?? null,
        after: safeAfter ?? null,
      }),
    );
    return tx.auditLog.create({
      data: {
        actorType: actor.type,
        actorId: actor.id ?? null,
        actorRole: actor.role ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        journalId: input.journalId ?? null,
        ...(safeBefore !== undefined ? { before: safeBefore } : {}),
        ...(safeAfter !== undefined ? { after: safeAfter } : {}),
        outcome: 'SUCCESS',
        ipHash: hashOpaqueToken(request.ip),
        userAgentHash: hashOpaqueToken(request.headers['user-agent'] ?? ''),
        requestId: request.id,
        correlationId: request.id,
        prevHash: previous?.eventHash ?? null,
        eventHash,
      },
    });
  }

  async function resetStaffTotp(
    request: FastifyRequest,
    employeeId: string,
    action: 'employee.totp.reset.self' | 'employee.totp.reset.admin',
  ) {
    const resetAt = new Date();
    return serializableTransactionWithRetry(database, async (tx) => {
      const before = await tx.employee.findUnique({
        where: { id: employeeId },
        select: {
          id: true,
          status: true,
          totpEnabled: true,
          totpResetRequiredAt: true,
          roles: { select: { role: { select: { code: true } } } },
        },
      });
      if (!before)
        throw new BusinessRuleError('EMPLOYEE_NOT_FOUND', 'admin.security.employee_not_found');
      if (!before.totpEnabled)
        throw new BusinessRuleError('TOTP_RESET_ALREADY_PENDING', 'error.stale_action');

      const reset = await tx.employee.updateMany({
        where: { id: employeeId, status: 'ACTIVE', totpEnabled: true },
        data: {
          totpEnabled: false,
          totpSecretCipher: null,
          totpResetRequiredAt: resetAt,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      if (reset.count !== 1)
        throw new BusinessRuleError('TOTP_RESET_UNAVAILABLE', 'error.stale_action');

      const revokedSessions = await tx.staffSession.updateMany({
        where: { employeeId, revokedAt: null },
        data: { revokedAt: resetAt },
      });
      await tx.staffTotpEnrollment.updateMany({
        where: { employeeId, completedAt: null, revokedAt: null },
        data: { revokedAt: resetAt, secretCipher: null },
      });
      await appendAudit(tx, request, {
        action,
        entity: 'Employee',
        entityId: employeeId,
        before: {
          status: before.status,
          totpEnabled: before.totpEnabled,
          reEnrollmentRequired: Boolean(before.totpResetRequiredAt),
          roles: before.roles.map((membership) => membership.role.code).sort(),
        },
        after: {
          status: before.status,
          totpEnabled: false,
          reEnrollmentRequired: true,
          sessionsRevoked: revokedSessions.count,
          roles: before.roles.map((membership) => membership.role.code).sort(),
        },
      });
      return { employeeId, reEnrollmentRequired: true, sessionsRevoked: revokedSessions.count };
    });
  }

  app.get('/health/live', { schema: { tags: ['Operations'] } }, () => ({
    status: 'ok',
    version: config.DEPLOYED_SHA,
  }));
  app.get('/health/ready', { schema: { tags: ['Operations'] } }, async (_request, reply) => {
    try {
      await Promise.all([
        database.$queryRaw`SELECT 1`,
        redis.ping(),
        fileQueue.getJobCounts(),
        s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })),
      ]);
      return { status: 'ready', database: 'ok', redis: 'ok', queue: 'ok', storage: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', metrics.contentType);
    return metrics.metrics();
  });

  app.post(
    '/api/v1/auth/login',
    {
      config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
      schema: { tags: ['Authentication'] },
    },
    async (request, reply) => {
      if (config.NODE_ENV === 'production' && !config.LOCAL_AUTH_PRODUCTION_ENABLED) {
        return reply.code(503).send({
          code: 'LOCAL_AUTH_DISABLED',
          messageKey: 'error.system',
          correlationId: request.id,
        });
      }
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          code: 'VALIDATION_ERROR',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const employee = await database.employee.findUnique({
        where: { email: parsed.data.email.toLowerCase() },
        include: { roles: { include: { role: true } } },
      });
      const now = new Date();
      if (
        !employee ||
        employee.status !== 'ACTIVE' ||
        (employee.lockedUntil && employee.lockedUntil > now)
      ) {
        authDenied.inc({ reason: 'login' });
        return reply.code(401).send({
          code: 'INVALID_CREDENTIALS',
          messageKey: 'error.forbidden',
          correlationId: request.id,
        });
      }
      const passwordOk = employee.passwordHash
        ? await verifyPassword(employee.passwordHash, parsed.data.password)
        : false;
      if (!passwordOk) return rejectInvalidLogin(employee.id, request, reply);

      if (!employee.totpEnabled && !employee.totpSecretCipher && employee.totpResetRequiredAt) {
        const enrollmentToken = generateOpaqueToken();
        const enrollmentSecret = generateTotpSecret();
        const expiresAt = new Date(Date.now() + totpEnrollmentTtlMs);
        const enrollmentStarted = await serializableTransactionWithRetry(database, async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "employees" WHERE "id" = ${employee.id}::uuid FOR UPDATE
          `;
          const current = await tx.employee.findUnique({
            where: { id: employee.id },
            include: { roles: { include: { role: true } } },
          });
          if (
            !current ||
            current.status !== 'ACTIVE' ||
            current.passwordHash !== employee.passwordHash ||
            current.totpEnabled ||
            current.totpSecretCipher ||
            !current.totpResetRequiredAt
          )
            return false;
          const role = rolePriority.find((candidate) =>
            current.roles.some((membership) => membership.role.code === candidate),
          );
          await tx.staffTotpEnrollment.updateMany({
            where: { employeeId: employee.id, completedAt: null, revokedAt: null },
            data: { revokedAt: now, secretCipher: null },
          });
          const enrollment = await tx.staffTotpEnrollment.create({
            data: {
              employeeId: employee.id,
              tokenHash: hashOpaqueToken(enrollmentToken),
              secretCipher: encryptSecret(enrollmentSecret, config.ENCRYPTION_KEY),
              expiresAt,
            },
          });
          await tx.employee.update({
            where: { id: employee.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
          await appendAudit(tx, request, {
            action: 'employee.totp.enrollment.started',
            entity: 'StaffTotpEnrollment',
            entityId: enrollment.id,
            actor: {
              type: 'EMPLOYEE',
              id: employee.id,
              ...(role ? { role } : {}),
            },
            after: { employeeId: employee.id, expiresAt, reEnrollmentRequired: true },
          });
          return true;
        });
        if (!enrollmentStarted) return rejectInvalidLogin(employee.id, request, reply, false);
        reply.setCookie('hmqa_totp_enrollment', enrollmentToken, {
          httpOnly: true,
          secure: config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test',
          sameSite: 'strict',
          path: '/api/auth/totp',
          maxAge: Math.floor(totpEnrollmentTtlMs / 1000),
        });
        return reply.code(428).send({
          code: 'TOTP_ENROLLMENT_REQUIRED',
          messageKey: 'admin.security.enrollment_required',
          expiresAt: expiresAt.toISOString(),
          correlationId: request.id,
        });
      }

      let totpOk = false;
      if (employee.totpEnabled && employee.totpSecretCipher && parsed.data.totp) {
        try {
          totpOk = verifyTotp(
            decryptSecret(employee.totpSecretCipher, config.ENCRYPTION_KEY),
            parsed.data.totp,
          );
        } catch {
          totpOk = false;
        }
      }
      if (!totpOk) return rejectInvalidLogin(employee.id, request, reply);
      const token = generateOpaqueToken();
      const csrf = generateOpaqueToken();
      const session = await serializableTransactionWithRetry(database, async (tx) => {
        const current = await tx.employee.findUnique({ where: { id: employee.id } });
        if (
          !current ||
          current.status !== 'ACTIVE' ||
          !current.totpEnabled ||
          current.totpResetRequiredAt ||
          current.passwordHash !== employee.passwordHash ||
          current.totpSecretCipher !== employee.totpSecretCipher
        )
          return null;
        const created = await tx.staffSession.create({
          data: {
            employeeId: employee.id,
            tokenHash: hashOpaqueToken(token),
            csrfHash: hashOpaqueToken(csrf),
            twoFactorAt: now,
            stepUpUntil: new Date(Date.now() + 10 * 60_000),
            expiresAt: new Date(Date.now() + config.SESSION_ABSOLUTE_HOURS * 60 * 60_000),
            ipHash: hashOpaqueToken(request.ip),
            userAgentHash: hashOpaqueToken(request.headers['user-agent'] ?? ''),
          },
        });
        await tx.employee.update({
          where: { id: employee.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
        });
        return created;
      });
      if (!session) return rejectInvalidLogin(employee.id, request, reply, false);
      reply.setCookie('hmqa_session', token, {
        httpOnly: true,
        secure: config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test',
        sameSite: 'strict',
        path: '/',
        maxAge: config.SESSION_ABSOLUTE_HOURS * 60 * 60,
      });
      return { sessionId: session.id, csrfToken: csrf, expiresAt: session.expiresAt.toISOString() };
    },
  );

  app.get(
    '/api/v1/auth/totp/enrollment',
    {
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
      schema: { tags: ['Authentication'] },
    },
    async (request, reply) => {
      const token = request.cookies.hmqa_totp_enrollment;
      const enrollment = token
        ? await database.staffTotpEnrollment.findUnique({
            where: { tokenHash: hashOpaqueToken(token) },
            include: {
              employee: {
                select: {
                  email: true,
                  displayName: true,
                  status: true,
                  totpEnabled: true,
                  totpSecretCipher: true,
                  totpResetRequiredAt: true,
                },
              },
            },
          })
        : null;
      if (
        !enrollment ||
        enrollment.completedAt ||
        enrollment.revokedAt ||
        !enrollment.secretCipher ||
        enrollment.expiresAt <= new Date() ||
        enrollment.employee.status !== 'ACTIVE' ||
        enrollment.employee.totpEnabled ||
        enrollment.employee.totpSecretCipher ||
        !enrollment.employee.totpResetRequiredAt
      ) {
        if (enrollment?.secretCipher && !enrollment.completedAt)
          await database.staffTotpEnrollment.updateMany({
            where: { id: enrollment.id, completedAt: null },
            data: { revokedAt: enrollment.revokedAt ?? new Date(), secretCipher: null },
          });
        reply.clearCookie('hmqa_totp_enrollment', {
          httpOnly: true,
          secure: config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test',
          sameSite: 'strict',
          path: '/api/auth/totp',
        });
        return reply.code(404).send({
          code: 'TOTP_ENROLLMENT_INVALID',
          messageKey: 'admin.security.enrollment_expired',
          correlationId: request.id,
        });
      }
      const secret = decryptSecret(enrollment.secretCipher, config.ENCRYPTION_KEY);
      reply.header('cache-control', 'no-store');
      reply.header('pragma', 'no-cache');
      return {
        email: enrollment.employee.email,
        displayName: enrollment.employee.displayName,
        totpSecret: secret,
        otpauthUrl: `otpauth://totp/${encodeURIComponent(`HMQA:${enrollment.employee.email}`)}?secret=${encodeURIComponent(secret)}&issuer=HMQA`,
        expiresAt: enrollment.expiresAt.toISOString(),
      };
    },
  );

  app.post(
    '/api/v1/auth/totp/enrollment/complete',
    {
      config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
      schema: { tags: ['Authentication'] },
    },
    async (request, reply) => {
      if (request.headers.origin !== config.ADMIN_BASE_URL)
        return reply.code(403).send({
          code: 'ORIGIN_INVALID',
          messageKey: 'error.forbidden',
          correlationId: request.id,
        });
      const body = z
        .object({ totp: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(request.body);
      const enrollmentToken = request.cookies.hmqa_totp_enrollment;
      const enrollment = enrollmentToken
        ? await database.staffTotpEnrollment.findUnique({
            where: { tokenHash: hashOpaqueToken(enrollmentToken) },
            include: {
              employee: { include: { roles: { include: { role: true } } } },
            },
          })
        : null;
      const now = new Date();
      if (
        !enrollment ||
        enrollment.completedAt ||
        enrollment.revokedAt ||
        !enrollment.secretCipher ||
        enrollment.expiresAt <= now ||
        enrollment.employee.status !== 'ACTIVE' ||
        enrollment.employee.totpEnabled ||
        !enrollment.employee.totpResetRequiredAt
      ) {
        if (enrollment?.secretCipher && !enrollment.completedAt)
          await database.staffTotpEnrollment.updateMany({
            where: { id: enrollment.id, completedAt: null },
            data: { revokedAt: enrollment.revokedAt ?? now, secretCipher: null },
          });
        reply.clearCookie('hmqa_totp_enrollment', {
          httpOnly: true,
          secure: config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test',
          sameSite: 'strict',
          path: '/api/auth/totp',
        });
        return reply.code(404).send({
          code: 'TOTP_ENROLLMENT_INVALID',
          messageKey: 'admin.security.enrollment_expired',
          correlationId: request.id,
        });
      }
      const enrollmentSecretCipher = enrollment.secretCipher;
      const enrollmentSecret = decryptSecret(enrollmentSecretCipher, config.ENCRYPTION_KEY);
      if (!verifyTotp(enrollmentSecret, body.totp))
        return reply.code(422).send({
          code: 'TOTP_INVALID',
          messageKey: 'admin.security.invalid_credentials',
          correlationId: request.id,
        });

      const sessionToken = generateOpaqueToken();
      const csrf = generateOpaqueToken();
      const expiresAt = new Date(Date.now() + config.SESSION_ABSOLUTE_HOURS * 60 * 60_000);
      const role = rolePriority.find((candidate) =>
        enrollment.employee.roles.some((membership) => membership.role.code === candidate),
      );
      const session = await serializableTransactionWithRetry(database, async (tx) => {
        const claimed = await tx.staffTotpEnrollment.updateMany({
          where: {
            id: enrollment.id,
            completedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { completedAt: now, secretCipher: null },
        });
        if (claimed.count !== 1)
          throw new BusinessRuleError('TOTP_ENROLLMENT_STALE', 'admin.security.enrollment_expired');
        const activated = await tx.employee.updateMany({
          where: {
            id: enrollment.employeeId,
            status: 'ACTIVE',
            totpEnabled: false,
            totpResetRequiredAt: { not: null },
          },
          data: {
            totpSecretCipher: enrollmentSecretCipher,
            totpEnabled: true,
            totpResetRequiredAt: null,
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: now,
          },
        });
        if (activated.count !== 1)
          throw new BusinessRuleError('TOTP_ENROLLMENT_STALE', 'admin.security.enrollment_expired');
        await tx.staffSession.updateMany({
          where: { employeeId: enrollment.employeeId, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.staffTotpEnrollment.updateMany({
          where: {
            employeeId: enrollment.employeeId,
            id: { not: enrollment.id },
            completedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now, secretCipher: null },
        });
        const created = await tx.staffSession.create({
          data: {
            employeeId: enrollment.employeeId,
            tokenHash: hashOpaqueToken(sessionToken),
            csrfHash: hashOpaqueToken(csrf),
            twoFactorAt: now,
            stepUpUntil: new Date(Date.now() + 10 * 60_000),
            expiresAt,
            ipHash: hashOpaqueToken(request.ip),
            userAgentHash: hashOpaqueToken(request.headers['user-agent'] ?? ''),
          },
        });
        await appendAudit(tx, request, {
          action: 'employee.totp.enrolled',
          entity: 'Employee',
          entityId: enrollment.employeeId,
          actor: {
            type: 'EMPLOYEE',
            id: enrollment.employeeId,
            ...(role ? { role } : {}),
          },
          before: { totpEnabled: false, reEnrollmentRequired: true },
          after: { totpEnabled: true, reEnrollmentRequired: false },
        });
        return created;
      });

      reply.clearCookie('hmqa_totp_enrollment', {
        httpOnly: true,
        secure: config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test',
        sameSite: 'strict',
        path: '/api/auth/totp',
      });
      reply.setCookie('hmqa_session', sessionToken, {
        httpOnly: true,
        secure: config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test',
        sameSite: 'strict',
        path: '/',
        maxAge: config.SESSION_ABSOLUTE_HOURS * 60 * 60,
      });
      return {
        sessionId: session.id,
        csrfToken: csrf,
        expiresAt: session.expiresAt.toISOString(),
      };
    },
  );

  app.post(
    '/api/v1/auth/password/change',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: { tags: ['Authentication'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const body = staffStepUpSchema
        .extend({ newPassword: z.string().min(14).max(256) })
        .parse(request.body);
      if (
        !(await verifyStaffStepUpCredentials(
          request.actor!.id,
          body.currentPassword,
          body.currentTotp,
        ))
      ) {
        authDenied.inc({ reason: 'step_up' });
        return reply.code(403).send({
          code: 'STEP_UP_AUTH_FAILED',
          messageKey: 'admin.security.invalid_credentials',
          correlationId: request.id,
        });
      }
      if (body.currentPassword === body.newPassword)
        return reply.code(422).send({
          code: 'PASSWORD_UNCHANGED',
          messageKey: 'admin.security.password_unchanged',
          correlationId: request.id,
        });
      const passwordHash = await hashPassword(body.newPassword);
      await serializableTransactionWithRetry(database, async (tx) => {
        await tx.employee.update({
          where: { id: request.actor!.id },
          data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
        });
        const revoked = await tx.staffSession.updateMany({
          where: { employeeId: request.actor!.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await appendAudit(tx, request, {
          action: 'employee.password.changed',
          entity: 'Employee',
          entityId: request.actor!.id,
          after: { passwordChanged: true, sessionsRevoked: revoked.count },
        });
      });
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/auth/totp/reset',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: { tags: ['Authentication'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const body = staffStepUpSchema.parse(request.body);
      if (
        !(await verifyStaffStepUpCredentials(
          request.actor!.id,
          body.currentPassword,
          body.currentTotp,
        ))
      ) {
        authDenied.inc({ reason: 'step_up' });
        return reply.code(403).send({
          code: 'STEP_UP_AUTH_FAILED',
          messageKey: 'admin.security.invalid_credentials',
          correlationId: request.id,
        });
      }
      return resetStaffTotp(request, request.actor!.id, 'employee.totp.reset.self');
    },
  );

  app.post(
    '/api/v1/auth/logout',
    { preHandler: [authenticateStaff, verifyCsrf], schema: { tags: ['Authentication'] } },
    async (request, reply) => {
      if (request.sessionId)
        await database.staffSession.update({
          where: { id: request.sessionId },
          data: { revokedAt: new Date() },
        });
      reply.clearCookie('hmqa_session', { path: '/' });
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/auth/invitations/inspect',
    {
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
      schema: { tags: ['Authentication'] },
    },
    async (request, reply) => {
      const body = z
        .object({ token: z.string().min(32).max(256) })
        .strict()
        .parse(request.body);
      const invitation = await database.staffInvitation.findUnique({
        where: { tokenHash: hashOpaqueToken(body.token) },
        include: { employee: true },
      });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= new Date() ||
        !invitation.employee.totpSecretCipher
      )
        return reply.code(404).send({
          code: 'INVITATION_INVALID',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      const secret = decryptSecret(invitation.employee.totpSecretCipher, config.ENCRYPTION_KEY);
      return {
        email: invitation.employee.email,
        displayName: invitation.employee.displayName,
        totpSecret: secret,
        otpauthUrl: `otpauth://totp/${encodeURIComponent(`HMQA:${invitation.employee.email}`)}?secret=${encodeURIComponent(secret)}&issuer=HMQA`,
        expiresAt: invitation.expiresAt,
      };
    },
  );

  app.post(
    '/api/v1/auth/invitations/accept',
    {
      config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
      schema: { tags: ['Authentication'] },
    },
    async (request, reply) => {
      const body = z
        .object({
          token: z.string().min(32).max(256),
          password: z.string().min(14).max(256),
          totp: z.string().regex(/^\d{6}$/),
        })
        .strict()
        .parse(request.body);
      const invitation = await database.staffInvitation.findUnique({
        where: { tokenHash: hashOpaqueToken(body.token) },
        include: { employee: true },
      });
      if (!invitation || invitation.revokedAt || !invitation.employee.totpSecretCipher)
        return reply.code(404).send({
          code: 'INVITATION_INVALID',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      if (invitation.acceptedAt) {
        if (
          invitation.employee.status === 'ACTIVE' &&
          invitation.employee.passwordHash &&
          invitation.employee.totpEnabled
        )
          return reply.code(204).send();
        return reply.code(404).send({
          code: 'INVITATION_INVALID',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      }
      if (invitation.expiresAt <= new Date())
        return reply.code(404).send({
          code: 'INVITATION_INVALID',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      const secret = decryptSecret(invitation.employee.totpSecretCipher, config.ENCRYPTION_KEY);
      if (!verifyTotp(secret, body.totp))
        return reply.code(422).send({
          code: 'TOTP_INVALID',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const passwordHash = await hashPassword(body.password);
      const activated = await database.$transaction(async (tx) => {
        const accepted = await tx.staffInvitation.updateMany({
          where: {
            id: invitation.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { acceptedAt: new Date() },
        });
        if (accepted.count !== 1) return false;
        await tx.employee.update({
          where: { id: invitation.employeeId },
          data: {
            passwordHash,
            totpEnabled: true,
            status: 'ACTIVE',
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(4815162342)`;
        const previous = await tx.auditLog.findFirst({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { eventHash: true },
        });
        const eventHash = hashOpaqueToken(
          JSON.stringify({
            previous: previous?.eventHash ?? null,
            action: 'employee.invitation.accepted',
            employeeId: invitation.employeeId,
            requestId: request.id,
          }),
        );
        await tx.auditLog.create({
          data: {
            actorType: 'EMPLOYEE',
            actorId: invitation.employeeId,
            action: 'employee.invitation.accepted',
            entity: 'Employee',
            entityId: invitation.employeeId,
            after: { status: 'ACTIVE', totpEnabled: true },
            outcome: 'SUCCESS',
            ipHash: hashOpaqueToken(request.ip),
            userAgentHash: hashOpaqueToken(request.headers['user-agent'] ?? ''),
            requestId: request.id,
            correlationId: request.id,
            prevHash: previous?.eventHash ?? null,
            eventHash,
          },
        });
        return true;
      });
      if (!activated) {
        const current = await database.staffInvitation.findUnique({
          where: { id: invitation.id },
          include: { employee: true },
        });
        if (
          !current?.acceptedAt ||
          current.revokedAt ||
          current.employee.status !== 'ACTIVE' ||
          !current.employee.passwordHash ||
          !current.employee.totpEnabled
        )
          return reply.code(404).send({
            code: 'INVITATION_INVALID',
            messageKey: 'error.stale_action',
            correlationId: request.id,
          });
      }
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/v1/auth/me',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Authentication'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      const actor = request.actor!;
      const employee = await database.employee.findUniqueOrThrow({
        where: { id: actor.id },
        select: {
          id: true,
          email: true,
          displayName: true,
          totpEnabled: true,
          totpResetRequiredAt: true,
        },
      });
      return {
        id: employee.id,
        email: employee.email,
        displayName: employee.displayName,
        totpEnabled: employee.totpEnabled,
        totpReEnrollmentRequired: Boolean(employee.totpResetRequiredAt),
        role: actor.role,
        permissions: permissionsFor(actor.role),
        journalIds: [...actor.journalIds],
        stepUpVerified: actor.stepUpVerified,
      };
    },
  );

  app.get(
    '/api/v1/admin/dashboard',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Dashboard'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      const actor = request.actor!;
      const canReadSubmissions = hasPermission(actor.role, 'submission:read:journal');
      const scope = canReadSubmissions
        ? { journalId: { in: [...actor.journalIds] }, deletedAt: null }
        : { id: { in: [] as string[] } };
      const [total, pendingTechnical, underReview, revisions, published, failedNotifications] =
        await Promise.all([
          database.submission.count({ where: scope }),
          database.submission.count({
            where: { ...scope, status: { in: ['SUBMITTED', 'TECHNICAL_REVIEW'] } },
          }),
          database.submission.count({ where: { ...scope, status: 'UNDER_REVIEW' } }),
          database.submission.count({
            where: { ...scope, status: { in: ['REVISION_REQUESTED', 'REVISION_SUBMITTED'] } },
          }),
          database.submission.count({ where: { ...scope, status: 'PUBLISHED' } }),
          hasPermission(actor.role, 'operations:read')
            ? database.notification.count({ where: { status: { in: ['FAILED', 'DEAD_LETTER'] } } })
            : Promise.resolve(0),
        ]);
      return { total, pendingTechnical, underReview, revisions, published, failedNotifications };
    },
  );

  app.get('/api/v1/catalog/journals', { schema: { tags: ['Catalog'] } }, async (request) => {
    const locale = normalizeLocale(
      (request.query as { locale?: string }).locale ?? request.headers['accept-language'],
    );
    const rows = await database.journal.findMany({
      where: { active: true, retiredAt: null },
      include: {
        localizations: { where: { locale: databaseLocale(locale) } },
        currentRequirement: { select: { id: true, version: true, effectiveAt: true, state: true } },
      },
      orderBy: { code: 'asc' },
    });
    return {
      locale,
      items: rows.map((journal) => ({
        id: journal.id,
        code: journal.code,
        mode: journal.mode,
        name: journal.localizations[0]?.name ?? journal.code,
        description: journal.localizations[0]?.description ?? '',
        contactText: journal.localizations[0]?.contactText ?? null,
        requirements: journal.currentRequirement,
      })),
    };
  });

  app.post(
    '/api/v1/internal/telegram/updates/claim',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request) => {
      const updateId = z
        .string()
        .regex(/^\d+$/)
        .transform(BigInt)
        .parse((request.body as { updateId?: unknown })?.updateId);
      const existing = await database.telegramUpdate.findUnique({ where: { updateId } });
      if (existing) {
        if (existing.processedAt) return { claimed: false, correlationId: existing.correlationId };
        // A process may die after claiming but before releasing. Treat the row as a
        // short lease so Telegram's retry can recover instead of being suppressed forever.
        const reclaimed = await database.telegramUpdate.updateMany({
          where: {
            updateId,
            processedAt: null,
            receivedAt: { lte: new Date(Date.now() - 2 * 60_000) },
          },
          data: { receivedAt: new Date(), correlationId: request.id, outcome: null },
        });
        return {
          claimed: reclaimed.count === 1,
          correlationId: reclaimed.count === 1 ? request.id : existing.correlationId,
        };
      }
      try {
        const claimed = await database.telegramUpdate.create({
          data: { updateId, correlationId: request.id },
        });
        return { claimed: true, correlationId: claimed.correlationId };
      } catch {
        const raced = await database.telegramUpdate.findUniqueOrThrow({ where: { updateId } });
        return { claimed: false, correlationId: raced.correlationId };
      }
    },
  );

  app.post(
    '/api/v1/internal/telegram/updates/:updateId/complete',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const updateId = z
        .string()
        .regex(/^\d+$/)
        .transform(BigInt)
        .parse((request.params as { updateId: string }).updateId);
      const body = z
        .object({ outcome: z.enum(['PROCESSED', 'IGNORED']) })
        .strict()
        .parse(request.body);
      const result = await database.telegramUpdate.updateMany({
        where: { updateId, processedAt: null },
        data: { processedAt: new Date(), outcome: body.outcome },
      });
      return result.count === 1
        ? reply.code(204).send()
        : reply.code(409).send({
            code: 'UPDATE_NOT_CLAIMED',
            messageKey: 'error.stale_action',
            correlationId: request.id,
          });
    },
  );

  app.post(
    '/api/v1/internal/telegram/updates/:updateId/release',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const updateId = z
        .string()
        .regex(/^\d+$/)
        .transform(BigInt)
        .parse((request.params as { updateId: string }).updateId);
      await database.telegramUpdate.deleteMany({ where: { updateId, processedAt: null } });
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/sync',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request) => {
      const body = z
        .object({
          telegramUserId: z.string().regex(/^\d+$/),
          telegramChatId: z.string().regex(/^-?\d+$/),
          username: z.string().max(64).nullable().optional(),
        })
        .strict()
        .parse(request.body);
      const user = await database.user.upsert({
        where: { telegramUserId: BigInt(body.telegramUserId) },
        update: {
          telegramChatId: BigInt(body.telegramChatId),
          ...(body.username !== undefined ? { username: body.username } : {}),
        },
        create: {
          telegramUserId: BigInt(body.telegramUserId),
          telegramChatId: BigInt(body.telegramChatId),
          username: body.username ?? null,
        },
        include: {
          consents: {
            where: { granted: true, revokedAt: null },
            orderBy: { grantedAt: 'desc' },
            take: 1,
          },
          drafts: {
            where: { deletedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            include: hydratedDraftInclude,
          },
          authorProfile: true,
        },
      });
      return {
        id: user.id,
        locale: user.locale ? publicLocale(user.locale) : null,
        status: user.status,
        consentActive: user.consents.length > 0,
        activeDraft: user.drafts[0] ?? null,
        profile: user.authorProfile
          ? {
              firstName: user.authorProfile.firstName,
              lastName: user.authorProfile.lastName,
              middleName: user.authorProfile.middleName,
              organization: user.authorProfile.organization,
              position: user.authorProfile.position,
              degree: user.authorProfile.degree,
              academicTitle: user.authorProfile.academicTitle,
              country: user.authorProfile.country,
              city: user.authorProfile.city,
              orcid: user.authorProfile.orcid,
              email: maskEmail(
                decryptSecret(user.authorProfile.emailCipher, config.ENCRYPTION_KEY),
              ),
              phone: maskPhone(
                decryptSecret(user.authorProfile.phoneCipher, config.ENCRYPTION_KEY),
              ),
              updatedAt: user.authorProfile.updatedAt,
            }
          : null,
      };
    },
  );

  app.patch(
    '/api/v1/internal/telegram/users/:telegramUserId/locale',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const body = z
        .object({ locale: z.enum(['uz-Latn', 'ru', 'en']) })
        .strict()
        .parse(request.body);
      const user = await database.user.update({
        where: { telegramUserId: BigInt(telegramUserId) },
        data: { locale: databaseLocale(body.locale) },
      });
      return { id: user.id, locale: body.locale };
    },
  );

  app.delete(
    '/api/v1/internal/telegram/users/:telegramUserId/drafts/:draftId',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), draftId: z.uuid() })
        .parse(request.params);
      const user = await telegramUser(params.telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const removed = await database.draft.updateMany({
        where: { id: params.draftId, userId: user.id, deletedAt: null },
        data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
      });
      return removed.count === 1
        ? reply.code(204).send()
        : reply.code(404).send({
            code: 'NOT_FOUND',
            messageKey: 'error.stale_action',
            correlationId: request.id,
          });
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/:telegramUserId/consents',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const body = z
        .object({
          policyVersion: z.string().min(1).max(64),
          scope: z.string().min(1).max(100),
          granted: z.boolean(),
          locale: z.enum(['uz-Latn', 'ru', 'en']),
          fingerprint: z.string().max(128).optional(),
        })
        .strict()
        .parse(request.body);
      const user = await database.user.findUnique({
        where: { telegramUserId: BigInt(telegramUserId) },
      });
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const consent = await database.consentRecord.create({
        data: {
          userId: user.id,
          policyVersion: body.policyVersion,
          scope: body.scope,
          granted: body.granted,
          locale: databaseLocale(body.locale),
          fingerprint: body.fingerprint ?? null,
          ...(!body.granted ? { revokedAt: new Date() } : {}),
        },
      });
      return reply.code(201).send({
        id: consent.id,
        granted: consent.granted,
        grantedAt: consent.grantedAt.toISOString(),
      });
    },
  );

  app.get(
    '/api/v1/internal/telegram/users/:telegramUserId/consents',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const user = await telegramUser(telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const items = await database.consentRecord.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          policyVersion: true,
          scope: true,
          granted: true,
          grantedAt: true,
          revokedAt: true,
          locale: true,
        },
        orderBy: { grantedAt: 'desc' },
      });
      return {
        items: items.map((item) => ({ ...item, locale: publicLocale(item.locale) })),
      };
    },
  );

  app.get(
    '/api/v1/internal/telegram/users/:telegramUserId/data-subject-requests',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const user = await telegramUser(telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const items = await database.dataSubjectRequest.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          publicId: true,
          type: true,
          status: true,
          dueAt: true,
          decisionReason: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return { items };
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/:telegramUserId/data-subject-requests',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const body = z
        .object({
          type: z.enum(['ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION']),
          requestNote: z.string().trim().min(1).max(2_000).optional(),
        })
        .strict()
        .parse(request.body);
      const user = await telegramUser(telegramUserId);
      if (!user || !user.locale)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const userLocale = user.locale;
      const result = await serializableTransactionWithRetry(
        database,
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;
          const existing = await tx.dataSubjectRequest.findFirst({
            where: {
              userId: user.id,
              type: body.type,
              status: {
                in: ['RECEIVED', 'IDENTITY_VERIFICATION', 'IN_REVIEW', 'APPROVED', 'EXECUTING'],
              },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (existing) return { item: existing, created: false };
          const now = new Date();
          const item = await tx.dataSubjectRequest.create({
            data: {
              publicId: `DSR-${now.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
              userId: user.id,
              type: body.type,
              locale: userLocale,
              requestNote: body.requestNote ?? null,
              dueAt: new Date(now.getTime() + config.PRIVACY_REQUEST_DUE_DAYS * 24 * 60 * 60_000),
            },
          });
          await tx.notification.create({
            data: {
              eventId: randomUUID(),
              userId: user.id,
              eventCode: 'privacy.request.received',
              locale: userLocale,
              templateVersion: 'static-v1',
              templateSnapshot: { key: 'privacy.notification.received' },
              variables: { public_id: item.publicId },
            },
          });
          await appendAudit(tx, request, {
            action: 'privacy.request.created',
            entity: 'DataSubjectRequest',
            entityId: item.id,
            after: { type: item.type, status: item.status, dueAt: item.dueAt },
            actor: { type: 'USER', id: user.id, role: 'AUTHOR' },
          });
          return { item, created: true };
        },
        { lockAuditChain: true },
      );
      return reply.code(result.created ? 201 : 200).send({
        id: result.item.id,
        publicId: result.item.publicId,
        type: result.item.type,
        status: result.item.status,
        dueAt: result.item.dueAt,
        created: result.created,
      });
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/:telegramUserId/drafts',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const body = z
        .object({ journalId: z.uuid().optional() })
        .strict()
        .parse(request.body ?? {});
      const user = await database.user.findUnique({
        where: { telegramUserId: BigInt(telegramUserId) },
        include: {
          consents: { where: { granted: true, revokedAt: null }, take: 1 },
          authorProfile: true,
        },
      });
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (user.consents.length === 0)
        return reply.code(409).send({
          code: 'CONSENT_REQUIRED',
          messageKey: 'consent.short',
          correlationId: request.id,
        });
      const journal = body.journalId
        ? await database.journal.findUnique({
            where: { id: body.journalId },
            include: {
              currentRequirement: { include: { localizations: true } },
              localizations: true,
            },
          })
        : null;
      const now = new Date();
      if (
        body.journalId &&
        (!journal ||
          !journal.active ||
          journal.mode !== 'NATIVE' ||
          !journal.currentRequirement ||
          journal.currentRequirement.state !== 'PUBLISHED' ||
          (journal.acceptanceOpensAt && journal.acceptanceOpensAt > now) ||
          (journal.acceptanceClosesAt && journal.acceptanceClosesAt <= now))
      ) {
        return reply.code(409).send({
          code: 'JOURNAL_CLOSED',
          messageKey: 'journal.acceptance_status',
          correlationId: request.id,
        });
      }
      const activeDraft = await database.draft.findFirst({
        where: { userId: user.id, deletedAt: null, expiresAt: { gt: now } },
        include: hydratedDraftInclude,
        orderBy: { updatedAt: 'desc' },
      });
      if (activeDraft) {
        if (activeDraft.journalId === (body.journalId ?? null)) return reply.send(activeDraft);
        throw new BusinessRuleError('ACTIVE_DRAFT_CONFLICT', 'profile.active_draft_conflict');
      }
      await database.draft.updateMany({
        where: { userId: user.id, deletedAt: null, expiresAt: { lte: now } },
        data: { deletedAt: now },
      });
      const draft = await database.draft.create({
        data: {
          userId: user.id,
          ...(body.journalId ? { journalId: body.journalId } : {}),
          ...(journal?.currentRequirement?.id
            ? { requirementVersionId: journal.currentRequirement.id }
            : {}),
          machineState: body.journalId ? 'REQUIREMENTS_ACK' : 'JOURNAL_LIST',
          expectedInputType: 'CALLBACK',
          context: user.authorProfile
            ? {
                profileSnapshotAvailable: true,
                firstName: user.authorProfile.firstName,
                lastName: user.authorProfile.lastName,
                middleName: user.authorProfile.middleName ?? '-',
                phone: decryptSecret(user.authorProfile.phoneCipher, config.ENCRYPTION_KEY),
                email: decryptSecret(user.authorProfile.emailCipher, config.ENCRYPTION_KEY),
                organization: user.authorProfile.organization,
                position: user.authorProfile.position,
                degree: user.authorProfile.degree ?? '-',
                academicTitle: user.authorProfile.academicTitle ?? '-',
                country: user.authorProfile.country ?? '-',
                city: user.authorProfile.city ?? '-',
                orcid: user.authorProfile.orcid ?? '-',
              }
            : {},
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        },
        include: hydratedDraftInclude,
      });
      return reply.code(201).send(draft);
    },
  );

  app.patch(
    '/api/v1/internal/telegram/users/:telegramUserId/drafts/:draftId',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), draftId: z.uuid() })
        .parse(request.params);
      const body = z
        .object({
          expectedRowVersion: z.number().int().nonnegative(),
          machineState: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
          expectedInputType: z.string().max(64).nullable(),
          contextPatch: z.record(z.string(), z.unknown()).default({}),
        })
        .strict()
        .parse(request.body);
      const user = await database.user.findUnique({
        where: { telegramUserId: BigInt(params.telegramUserId) },
      });
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const result = await database.$transaction(async (tx) => {
        const draft = await tx.draft.findFirst({
          where: { id: params.draftId, userId: user.id, deletedAt: null },
        });
        if (!draft || draft.rowVersion !== body.expectedRowVersion) return null;
        const currentContext =
          typeof draft.context === 'object' && draft.context && !Array.isArray(draft.context)
            ? draft.context
            : {};
        const mergedContext = JSON.parse(
          JSON.stringify({ ...currentContext, ...body.contextPatch }),
        ) as Prisma.InputJsonValue;
        const updated = await tx.draft.updateMany({
          where: { id: draft.id, userId: user.id, rowVersion: body.expectedRowVersion },
          data: {
            machineState: body.machineState,
            expectedInputType: body.expectedInputType,
            context: mergedContext,
            rowVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) return null;
        return tx.draft.findUniqueOrThrow({
          where: { id: draft.id },
          include: hydratedDraftInclude,
        });
      });
      if (!result)
        return reply.code(409).send({
          code: 'STALE_ACTION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      return result;
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/:telegramUserId/profile-draft',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const body = z
        .object({ section: z.enum(['all', 'name', 'phone', 'email', 'work', 'academic']) })
        .strict()
        .parse(request.body);
      const user = await database.user.findUnique({
        where: { telegramUserId: BigInt(telegramUserId) },
        include: {
          authorProfile: true,
          consents: { where: { granted: true, revokedAt: null }, take: 1 },
          drafts: { where: { deletedAt: null, expiresAt: { gt: new Date() } }, take: 1 },
        },
      });
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (user.consents.length === 0)
        throw new BusinessRuleError('CONSENT_REQUIRED', 'consent.short');
      if (user.drafts.length > 0)
        throw new BusinessRuleError('ACTIVE_DRAFT_CONFLICT', 'profile.active_draft_conflict');
      const section = user.authorProfile ? body.section : 'all';
      const profile = user.authorProfile;
      const context: Prisma.InputJsonObject = {
        profileDraft: true,
        profileSection: section,
        ...(profile
          ? {
              firstName: profile.firstName,
              lastName: profile.lastName,
              middleName: profile.middleName ?? '-',
              phone: decryptSecret(profile.phoneCipher, config.ENCRYPTION_KEY),
              email: decryptSecret(profile.emailCipher, config.ENCRYPTION_KEY),
              organization: profile.organization,
              position: profile.position,
              degree: profile.degree ?? '-',
              academicTitle: profile.academicTitle ?? '-',
              country: profile.country ?? '-',
              city: profile.city ?? '-',
              orcid: profile.orcid ?? '-',
            }
          : {}),
      };
      const initialState = {
        all: 'PROFILE_LAST_NAME',
        name: 'PROFILE_LAST_NAME',
        phone: 'PROFILE_PHONE',
        email: 'PROFILE_EMAIL',
        work: 'PROFILE_ORGANIZATION',
        academic: 'PROFILE_DEGREE',
      }[section];
      const draft = await database.draft.create({
        data: {
          userId: user.id,
          machineState: initialState,
          expectedInputType: 'TEXT',
          context,
          expiresAt: new Date(Date.now() + config.RETENTION_DRAFT_DAYS * 24 * 60 * 60_000),
        },
        include: hydratedDraftInclude,
      });
      return reply.code(201).send(draft);
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/:telegramUserId/profile-drafts/:draftId/submit',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), draftId: z.uuid() })
        .parse(request.params);
      const body = z
        .object({ expectedRowVersion: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      const user = await telegramUser(params.telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const result = await serializableTransactionWithRetry(
        database,
        async (tx) => {
          const draft = await tx.draft.findFirst({
            where: { id: params.draftId, userId: user.id, deletedAt: null },
          });
          if (
            !draft ||
            draft.rowVersion !== body.expectedRowVersion ||
            draft.machineState !== 'PROFILE_CONFIRM'
          )
            return null;
          const context = draftContext(draft.context);
          if (context.profileDraft !== true)
            throw new BusinessRuleError('PROFILE_DRAFT_INVALID', 'error.stale_action');
          const firstName = requiredContextString(context, 'firstName', 100);
          const lastName = requiredContextString(context, 'lastName', 100);
          const middleName = optionalContextString(context, 'middleName', 100);
          const phone = requiredContextString(context, 'phone', 32);
          if (!/^\+[1-9]\d{7,14}$/.test(phone))
            throw new BusinessRuleError('PHONE_INVALID', 'validation.phone', 422);
          const email = requiredContextString(context, 'email', 320).toLowerCase();
          if (!z.email().safeParse(email).success)
            throw new BusinessRuleError('EMAIL_INVALID', 'validation.email', 422);
          const organization = requiredContextString(context, 'organization', 300);
          const position = requiredContextString(context, 'position', 200);
          const degree = optionalContextString(context, 'degree', 200);
          const academicTitle = optionalContextString(context, 'academicTitle', 200);
          const country = optionalContextString(context, 'country', 100);
          const city = optionalContextString(context, 'city', 100);
          const rawOrcid = optionalContextString(context, 'orcid', 19);
          const parsedOrcid = rawOrcid ? orcidSchema.safeParse(rawOrcid) : null;
          if (parsedOrcid && !parsedOrcid.success)
            throw new BusinessRuleError('ORCID_INVALID', 'validation.orcid', 422);
          const before = await tx.authorProfile.findUnique({ where: { userId: user.id } });
          const updated = await tx.authorProfile.upsert({
            where: { userId: user.id },
            update: {
              firstName,
              lastName,
              middleName,
              phoneCipher: encryptSecret(phone, config.ENCRYPTION_KEY),
              phoneHash: hashOpaqueToken(phone),
              emailCipher: encryptSecret(email, config.ENCRYPTION_KEY),
              emailHash: hashOpaqueToken(email),
              organization,
              position,
              degree,
              academicTitle,
              country,
              city,
              orcid: parsedOrcid?.data ?? null,
              rowVersion: { increment: 1 },
            },
            create: {
              userId: user.id,
              firstName,
              lastName,
              middleName,
              phoneCipher: encryptSecret(phone, config.ENCRYPTION_KEY),
              phoneHash: hashOpaqueToken(phone),
              emailCipher: encryptSecret(email, config.ENCRYPTION_KEY),
              emailHash: hashOpaqueToken(email),
              organization,
              position,
              degree,
              academicTitle,
              country,
              city,
              orcid: parsedOrcid?.data ?? null,
            },
          });
          await tx.draft.update({
            where: { id: draft.id },
            data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
          });
          await appendAudit(tx, request, {
            action: before ? 'profile.updated' : 'profile.created',
            entity: 'AuthorProfile',
            entityId: updated.id,
            before: before ? { rowVersion: before.rowVersion } : null,
            after: {
              rowVersion: updated.rowVersion,
              section: typeof context.profileSection === 'string' ? context.profileSection : 'all',
            },
            actor: { type: 'USER', id: user.id, role: 'AUTHOR' },
          });
          return { id: updated.id, updatedAt: updated.updatedAt };
        },
        { lockAuditChain: true },
      );
      if (!result)
        return reply.code(409).send({
          code: 'STALE_ACTION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      return result;
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/:telegramUserId/drafts/:draftId/files',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), draftId: z.uuid() })
        .parse(request.params);
      const body = z
        .object({
          expectedRowVersion: z.number().int().nonnegative(),
          fileId: z.string().min(1).max(256),
          fileUniqueId: z.string().min(1).max(256),
          fileName: z
            .string()
            .min(1)
            .max(500)
            .refine((value) =>
              [...value].every((character) => {
                const code = character.codePointAt(0) ?? 0;
                return code >= 32 && code !== 127;
              }),
            ),
          declaredMime: z.string().max(200).optional(),
          sizeBytes: z.number().int().positive().max(config.FILE_MAX_BYTES),
          category: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
        })
        .strict()
        .parse(request.body);
      const user = await telegramUser(params.telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const sourceKey = `telegram:${body.fileUniqueId}`;
      const result = await serializableTransactionWithRetry(
        database,
        async (tx) => {
          const draft = await tx.draft.findFirst({
            where: { id: params.draftId, userId: user.id, deletedAt: null },
            include: { requirementVersion: true },
          });
          if (
            !draft ||
            draft.rowVersion !== body.expectedRowVersion ||
            !['FILE_ARTICLE', 'FILE_SCANNING'].includes(draft.machineState)
          )
            return null;
          if (!draft.requirementVersion)
            throw new BusinessRuleError('REQUIREMENT_CONFIG_MISSING', 'error.file_set_incomplete');
          const ruleConfig = journalRequirementConfigSchema.safeParse(
            draft.requirementVersion.config,
          );
          if (!ruleConfig.success)
            throw new BusinessRuleError('REQUIREMENT_CONFIG_INVALID', 'error.file_set_incomplete');
          const policy = ruleConfig.data.requiredFiles.find(
            (candidate) => candidate.category === body.category,
          );
          if (!policy)
            throw new BusinessRuleError('FILE_CATEGORY_NOT_ALLOWED', 'error.file_format', 422);
          const extension = fileExtension(body.fileName);
          if (!extension || !policy.formats.includes(extension as 'docx' | 'pdf'))
            throw new BusinessRuleError('FILE_FORMAT', 'error.file_format', 422);
          const maxBytes = Math.min(
            policy.maxBytes ?? ruleConfig.data.limits.maxBytes,
            ruleConfig.data.limits.maxBytes,
            config.FILE_MAX_BYTES,
          );
          if (body.sizeBytes > maxBytes)
            throw new BusinessRuleError('FILE_TOO_LARGE', 'error.file_size', 422);
          const existing = await tx.fileAsset.findUnique({ where: { sourceKey } });
          const asset =
            existing ??
            (await tx.fileAsset.create({
              data: {
                sourceKey,
                originalName: body.fileName,
                declaredMime: body.declaredMime ?? null,
                extension,
                sizeBytes: BigInt(body.sizeBytes),
                provenance: {
                  provider: 'telegram',
                  providerFileId: body.fileId,
                  providerFileUniqueId: body.fileUniqueId,
                },
              },
            }));
          await tx.draftFile.updateMany({
            where: {
              draftId: draft.id,
              category: body.category,
              replacedAt: null,
              fileId: { not: asset.id },
            },
            data: { replacedAt: new Date() },
          });
          await tx.draftFile.upsert({
            where: { draftId_fileId: { draftId: draft.id, fileId: asset.id } },
            update: { replacedAt: null, category: body.category, required: policy.required },
            create: {
              draftId: draft.id,
              fileId: asset.id,
              category: body.category,
              required: policy.required,
            },
          });
          await tx.draftPreflightRun.upsert({
            where: { draftId_fileId: { draftId: draft.id, fileId: asset.id } },
            update: {
              status: 'PENDING',
              startedAt: null,
              finishedAt: null,
              blockingCount: 0,
              errorCount: 0,
              warningCount: 0,
              findings: [],
            },
            create: {
              draftId: draft.id,
              fileId: asset.id,
              status: 'PENDING',
              ruleSetVersion: `${extension}-security-v1`,
              toolVersion: 'hmqa-document-validator-1',
            },
          });
          const updated = await tx.draft.updateMany({
            where: { id: draft.id, rowVersion: body.expectedRowVersion },
            data: {
              machineState: 'FILE_SCANNING',
              expectedInputType: 'CALLBACK',
              context: {
                ...draftContext(draft.context),
                activeFileCategory: body.category,
              },
              rowVersion: { increment: 1 },
            },
          });
          if (updated.count !== 1) return null;
          return { assetId: asset.id, draftId: draft.id };
        },
        {},
      );
      if (!result)
        return reply.code(409).send({
          code: 'STALE_ACTION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      await fileQueue.add(
        jobNames.ingestTelegramFile,
        { fileAssetId: result.assetId },
        { jobId: `file-${result.assetId}` },
      );
      return database.draft.findUniqueOrThrow({
        where: { id: result.draftId },
        include: hydratedDraftInclude,
      });
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/:telegramUserId/drafts/:draftId/submit',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), draftId: z.uuid() })
        .parse(request.params);
      const body = z
        .object({ expectedRowVersion: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      const user = await telegramUser(params.telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const idempotencyKey = z
        .string()
        .trim()
        .min(1)
        .max(200)
        .parse(request.headers['idempotency-key'] ?? params.draftId);
      const idempotencyScope = `telegram-submit:${user.id}`;
      const idempotencyKeyHash = hashOpaqueToken(idempotencyKey);
      const idempotencyRequestHash = hashOpaqueToken(
        JSON.stringify({ draftId: params.draftId, expectedRowVersion: body.expectedRowVersion }),
      );
      const idempotencyClaimId = randomUUID();
      const result = await serializableTransactionWithRetry(
        database,
        async (tx) => {
          const idempotency = await tx.idempotencyRecord.upsert({
            where: {
              scope_keyHash: { scope: idempotencyScope, keyHash: idempotencyKeyHash },
            },
            update: {},
            create: {
              id: idempotencyClaimId,
              scope: idempotencyScope,
              keyHash: idempotencyKeyHash,
              requestHash: idempotencyRequestHash,
              lockedUntil: new Date(Date.now() + 60_000),
              expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
            },
          });
          if (idempotency.requestHash !== idempotencyRequestHash)
            throw new BusinessRuleError('IDEMPOTENCY_KEY_REUSED', 'error.stale_action');
          if (idempotency.id !== idempotencyClaimId) {
            if (idempotency.responseStatus === 201 && idempotency.responseBody) {
              const cached = submissionResultSchema.safeParse(idempotency.responseBody);
              if (cached.success) return cached.data;
              throw new Error('IDEMPOTENCY_RESPONSE_INVALID');
            }
            if (idempotency.lockedUntil > new Date())
              throw new BusinessRuleError('IDEMPOTENCY_IN_PROGRESS', 'error.stale_action');
            const reclaimed = await tx.idempotencyRecord.updateMany({
              where: { id: idempotency.id, lockedUntil: { lte: new Date() } },
              data: { lockedUntil: new Date(Date.now() + 60_000) },
            });
            if (reclaimed.count !== 1)
              throw new BusinessRuleError('IDEMPOTENCY_IN_PROGRESS', 'error.stale_action');
          }
          const completeIdempotency = async (response: z.infer<typeof submissionResultSchema>) => {
            await tx.idempotencyRecord.update({
              where: { id: idempotency.id },
              data: {
                responseStatus: 201,
                responseBody: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue,
                resourceId: response.submissionId,
                lockedUntil: new Date(),
              },
            });
            return response;
          };
          const draft = await tx.draft.findFirst({
            where: { id: params.draftId, userId: user.id, deletedAt: null },
            include: {
              journal: true,
              requirementVersion: true,
              files: { where: { replacedAt: null }, include: { file: true } },
              preflightRuns: { orderBy: { createdAt: 'desc' } },
            },
          });
          if (
            !draft ||
            draft.rowVersion !== body.expectedRowVersion ||
            draft.machineState !== 'PREVIEW'
          )
            throw new BusinessRuleError('STALE_ACTION', 'error.stale_action');
          const context = draftContext(draft.context);
          const revisionSubmissionId =
            typeof context.revisionSubmissionId === 'string' ? context.revisionSubmissionId : null;
          if (
            !draft.journal ||
            !draft.requirementVersion ||
            (!revisionSubmissionId && draft.requirementVersion.state !== 'PUBLISHED') ||
            (revisionSubmissionId &&
              !['PUBLISHED', 'RETIRED'].includes(draft.requirementVersion.state))
          )
            throw new BusinessRuleError('REQUIREMENTS_NOT_PUBLISHED', 'error.file_set_incomplete');
          const ruleConfig = journalRequirementConfigSchema.safeParse(
            draft.requirementVersion.config,
          );
          if (!ruleConfig.success)
            throw new BusinessRuleError('REQUIREMENT_CONFIG_INVALID', 'error.file_set_incomplete');
          if (
            draft.files.length > ruleConfig.data.limits.maxFiles ||
            draft.files.reduce((total, item) => total + Number(item.file.sizeBytes), 0) >
              ruleConfig.data.limits.maxTotalBytes
          )
            throw new BusinessRuleError('FILE_SET_LIMIT', 'error.file_size', 422);
          const acceptedFiles = draft.files.map((link) => {
            const policy = ruleConfig.data.requiredFiles.find(
              (candidate) => candidate.category === link.category,
            );
            const run = draft.preflightRuns.find((candidate) => candidate.fileId === link.fileId);
            if (
              !policy ||
              !link.file.extension ||
              !policy.formats.includes(link.file.extension as 'docx' | 'pdf') ||
              link.file.scanStatus !== 'CLEAN' ||
              link.file.storageStatus !== 'STORED' ||
              !link.file.sha256 ||
              !run ||
              run.status !== 'COMPLETED' ||
              run.blockingCount !== 0
            )
              throw new BusinessRuleError('FILE_NOT_READY', 'error.preflight_incomplete');
            return { link, policy, run };
          });
          if (
            ruleConfig.data.requiredFiles.some(
              (policy) =>
                policy.required &&
                !acceptedFiles.some((accepted) => accepted.policy.category === policy.category),
            )
          )
            throw new BusinessRuleError('REQUIRED_FILE_MISSING', 'error.file_set_incomplete');

          const persistFiles = async (submissionVersionId: string, submissionVersionNo: number) => {
            for (const accepted of acceptedFiles) {
              await tx.submissionFile.create({
                data: {
                  submissionVersionId,
                  fileId: accepted.link.fileId,
                  category: accepted.link.category,
                  required: accepted.policy.required,
                  versionNo: submissionVersionNo,
                },
              });
              await tx.preflightRun.create({
                data: {
                  submissionVersionId,
                  fileId: accepted.link.fileId,
                  status: 'COMPLETED',
                  ruleSetVersion: accepted.run.ruleSetVersion,
                  toolVersion: accepted.run.toolVersion,
                  blockingCount: accepted.run.blockingCount,
                  errorCount: accepted.run.errorCount,
                  warningCount: accepted.run.warningCount,
                  findings: JSON.parse(
                    JSON.stringify(accepted.run.findings),
                  ) as Prisma.InputJsonValue,
                  startedAt: accepted.run.startedAt,
                  finishedAt: accepted.run.finishedAt,
                },
              });
            }
          };
          const createReceipt = async (input: {
            submissionVersionId: string;
            submissionVersionNo: number;
            publicId: string;
            status: string;
            submittedAt: Date;
          }) =>
            tx.submissionReceipt.create({
              data: {
                submissionVersionId: input.submissionVersionId,
                locale: user.locale ?? 'uz_Latn',
                templateVersion: 'receipt-v1',
                dataSnapshot: {
                  publicId: input.publicId,
                  status: input.status,
                  submittedAt: input.submittedAt.toISOString(),
                  journalCode: draft.journal!.code,
                  submissionVersion: input.submissionVersionNo,
                  requirementsVersion: draft.requirementVersion!.version,
                  files: acceptedFiles.map((accepted) => ({
                    categoryLabel: accepted.policy.labels[publicLocale(user.locale ?? 'uz_Latn')],
                    originalName: accepted.link.file.originalName,
                    sha256: accepted.link.file.sha256!,
                    sizeBytes: accepted.link.file.sizeBytes.toString(),
                  })),
                },
              },
            });
          const firstName = requiredContextString(context, 'firstName', 100);
          const lastName = requiredContextString(context, 'lastName', 100);
          const middleName = optionalContextString(context, 'middleName', 100);
          const phone = requiredContextString(context, 'phone', 32);
          const email = requiredContextString(context, 'email', 320).toLowerCase();
          const organization = requiredContextString(context, 'organization', 300);
          const position = requiredContextString(context, 'position', 200);
          const degree = optionalContextString(context, 'degree', 200);
          const academicTitle = optionalContextString(context, 'academicTitle', 200);
          const country = optionalContextString(context, 'country', 100);
          const city = optionalContextString(context, 'city', 100);
          const rawOrcid = optionalContextString(context, 'orcid', 19);
          const parsedOrcid = rawOrcid ? orcidSchema.safeParse(rawOrcid) : null;
          if (parsedOrcid && !parsedOrcid.success)
            throw new BusinessRuleError('ORCID_INVALID', 'validation.orcid', 422);
          const orcid = parsedOrcid?.data ?? null;
          const articleTitle = requiredContextString(context, 'articleTitle', 1_000);
          const articleType = requiredContextString(context, 'articleType', 100);
          const articleLanguage = requiredContextString(context, 'articleLanguage', 32);
          if (!['uz-Latn', 'ru', 'en'].includes(articleLanguage))
            throw new BusinessRuleError(
              'ARTICLE_LANGUAGE_INVALID',
              'validation.article_language',
              422,
            );
          const articleSection = requiredContextString(context, 'articleSection', 100);
          const abstract = requiredContextString(context, 'abstract', 10_000);
          const abstractWords = abstract.trim().split(/\s+/u).length;
          if (
            abstractWords < ruleConfig.data.metadata.abstractMinWords ||
            abstractWords > ruleConfig.data.metadata.abstractMaxWords
          ) {
            throw new BusinessRuleError(
              'ABSTRACT_WORD_COUNT_INVALID',
              'validation.abstract_policy',
              422,
            );
          }
          const keywords = requiredContextString(context, 'keywords', 2_000)
            .split(/[,;\n]/)
            .map((item) => item.trim())
            .filter(Boolean);
          if (
            keywords.length < ruleConfig.data.metadata.keywordMinCount ||
            keywords.length > ruleConfig.data.metadata.keywordMaxCount
          ) {
            throw new BusinessRuleError('KEYWORDS_COUNT_INVALID', 'validation.keyword_policy', 422);
          }
          const coauthorInput = requiredContextString(context, 'coauthors', 10_000);
          const coauthors =
            coauthorInput === '-'
              ? []
              : coauthorInput.split('\n').map((line, index) => {
                  const [fullName, coauthorEmail, coauthorOrganization, ...extra] = line
                    .split('|')
                    .map((value) => value.trim());
                  if (
                    !fullName ||
                    !coauthorEmail ||
                    !coauthorOrganization ||
                    extra.length > 0 ||
                    !z.email().safeParse(coauthorEmail).success
                  )
                    throw new Error(`COAUTHOR_INVALID:${index + 1}`);
                  return {
                    fullName,
                    email: coauthorEmail.toLowerCase(),
                    organization: coauthorOrganization,
                  };
                });
          if (coauthors.length > ruleConfig.data.metadata.coauthorMaxCount) {
            throw new BusinessRuleError('COAUTHOR_LIMIT', 'validation.coauthor_policy', 422);
          }
          const emailCipher = encryptSecret(email, config.ENCRYPTION_KEY);
          const phoneCipher = encryptSecret(phone, config.ENCRYPTION_KEY);
          await tx.authorProfile.upsert({
            where: { userId: user.id },
            update: {
              firstName,
              lastName,
              middleName,
              phoneCipher,
              phoneHash: hashOpaqueToken(phone),
              emailCipher,
              emailHash: hashOpaqueToken(email),
              organization,
              position,
              degree,
              academicTitle,
              country,
              city,
              orcid,
              rowVersion: { increment: 1 },
            },
            create: {
              userId: user.id,
              firstName,
              lastName,
              middleName,
              phoneCipher,
              phoneHash: hashOpaqueToken(phone),
              emailCipher,
              emailHash: hashOpaqueToken(email),
              organization,
              position,
              degree,
              academicTitle,
              country,
              city,
              orcid,
            },
          });
          if (revisionSubmissionId) {
            const original = await tx.submission.findFirst({
              where: {
                id: revisionSubmissionId,
                ownerId: user.id,
                journalId: draft.journal.id,
                requirementVersionId: draft.requirementVersion.id,
                status: { in: ['NEEDS_CORRECTION', 'REVISION_REQUESTED'] },
                deletedAt: null,
              },
            });
            if (!original) throw new Error('REVISION_NOT_AVAILABLE');
            const nextVersionNo = original.currentVersionNo + 1;
            const version = await tx.submissionVersion.create({
              data: {
                submissionId: original.id,
                versionNo: nextVersionNo,
                submittedById: user.id,
                profileSnapshot: {
                  firstName,
                  lastName,
                  middleName,
                  organization,
                  position,
                  degree,
                  academicTitle,
                  country,
                  city,
                  orcid,
                  emailCipher,
                  phoneCipher,
                },
                declarations: {
                  requirementsAcknowledgedAt: context.requirementsAcknowledgedAt ?? null,
                  originalityConfirmed: true,
                },
                changeNote: 'Author submitted a corrected manuscript version.',
              },
            });
            await tx.submissionAuthor.create({
              data: {
                submissionVersionId: version.id,
                authorOrder: 1,
                isCorresponding: true,
                dataSnapshot: {
                  firstName,
                  lastName,
                  middleName,
                  organization,
                  position,
                  degree,
                  academicTitle,
                  country,
                  city,
                  orcid,
                },
              },
            });
            if (coauthors.length > 0) {
              await tx.submissionAuthor.createMany({
                data: coauthors.map((coauthor, index) => ({
                  submissionVersionId: version.id,
                  authorOrder: index + 2,
                  isCorresponding: false,
                  dataSnapshot: {
                    fullName: coauthor.fullName,
                    organization: coauthor.organization,
                    emailCipher: encryptSecret(coauthor.email, config.ENCRYPTION_KEY),
                    emailHash: hashOpaqueToken(coauthor.email),
                  },
                })),
              });
            }
            const metadataPayload = {
              articleTitle,
              articleType,
              articleLanguage,
              articleSection,
              abstract,
              keywords,
            };
            await tx.submissionMetadata.create({
              data: {
                submissionVersionId: version.id,
                manuscriptLanguage: articleLanguage,
                articleType,
                sectionCode: articleSection,
                titles: { [articleLanguage]: articleTitle },
                abstracts: { [articleLanguage]: abstract },
                keywords: { [articleLanguage]: keywords },
                fingerprint: hashOpaqueToken(JSON.stringify(metadataPayload)),
              },
            });
            await persistFiles(version.id, nextVersionNo);
            const targetStatus =
              original.status === 'REVISION_REQUESTED'
                ? ('REVISION_SUBMITTED' as const)
                : ('TECHNICAL_REVIEW' as const);
            const updated = await tx.submission.updateMany({
              where: { id: original.id, rowVersion: original.rowVersion, status: original.status },
              data: {
                status: targetStatus,
                currentVersionNo: nextVersionNo,
                rowVersion: { increment: 1 },
              },
            });
            if (updated.count !== 1) throw new Error('CONCURRENT_UPDATE');
            await tx.statusHistory.create({
              data: {
                submissionId: original.id,
                fromStatus: original.status,
                toStatus: targetStatus,
                actorType: 'USER',
                actorId: user.id,
                actorRole: 'AUTHOR',
                correlationId: request.id,
              },
            });
            await tx.notification.create({
              data: {
                eventId: randomUUID(),
                submissionId: original.id,
                userId: user.id,
                eventCode: `submission.${targetStatus.toLowerCase()}`,
                locale: user.locale ?? 'uz_Latn',
                templateVersion: 'static-v1',
                templateSnapshot: { key: `status.${targetStatus.toLowerCase()}` },
                variables: { public_id: original.publicId },
              },
            });
            const receipt = await createReceipt({
              submissionVersionId: version.id,
              submissionVersionNo: nextVersionNo,
              publicId: original.publicId,
              status: targetStatus,
              submittedAt: version.createdAt,
            });
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(4815162342)`;
            const previousAudit = await tx.auditLog.findFirst({
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { eventHash: true },
            });
            const eventHash = hashOpaqueToken(
              JSON.stringify({
                previous: previousAudit?.eventHash ?? null,
                action: 'submission.revision.created',
                submissionId: original.id,
                versionNo: nextVersionNo,
                actorId: user.id,
                requestId: request.id,
              }),
            );
            await tx.auditLog.create({
              data: {
                actorType: 'USER',
                actorId: user.id,
                actorRole: 'AUTHOR',
                action: 'submission.revision.created',
                entity: 'Submission',
                entityId: original.id,
                journalId: original.journalId,
                before: {
                  status: original.status,
                  currentVersionNo: original.currentVersionNo,
                },
                after: { status: targetStatus, currentVersionNo: nextVersionNo },
                outcome: 'SUCCESS',
                ipHash: hashOpaqueToken(request.ip),
                userAgentHash: hashOpaqueToken(request.headers['user-agent'] ?? ''),
                requestId: request.id,
                correlationId: request.id,
                prevHash: previousAudit?.eventHash ?? null,
                eventHash,
              },
            });
            await tx.draft.update({
              where: { id: draft.id },
              data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
            });
            return completeIdempotency({
              submissionId: original.id,
              publicId: original.publicId,
              status: targetStatus,
              submittedAt: version.createdAt,
              receiptJobId: receipt.id,
            });
          }
          const year = new Date().getUTCFullYear();
          const sequence = await tx.journalYearSequence.upsert({
            where: { journalCode_year: { journalCode: draft.journal.code, year } },
            update: { value: { increment: 1 } },
            create: { journalCode: draft.journal.code, year, value: 1 },
          });
          const publicId = `HMQA-${draft.journal.code}-${year}-${String(sequence.value).padStart(6, '0')}`;
          const submission = await tx.submission.create({
            data: {
              publicId,
              journalId: draft.journal.id,
              ownerId: user.id,
              requirementVersionId: draft.requirementVersion.id,
            },
          });
          const version = await tx.submissionVersion.create({
            data: {
              submissionId: submission.id,
              versionNo: 1,
              submittedById: user.id,
              profileSnapshot: {
                firstName,
                lastName,
                middleName,
                organization,
                position,
                degree,
                academicTitle,
                country,
                city,
                orcid,
                emailCipher,
                phoneCipher,
              },
              declarations: {
                requirementsAcknowledgedAt: context.requirementsAcknowledgedAt ?? null,
                originalityConfirmed: true,
              },
            },
          });
          await tx.submissionAuthor.create({
            data: {
              submissionVersionId: version.id,
              authorOrder: 1,
              isCorresponding: true,
              dataSnapshot: {
                firstName,
                lastName,
                middleName,
                organization,
                position,
                degree,
                academicTitle,
                country,
                city,
                orcid,
              },
            },
          });
          if (coauthors.length > 0) {
            await tx.submissionAuthor.createMany({
              data: coauthors.map((coauthor, index) => ({
                submissionVersionId: version.id,
                authorOrder: index + 2,
                isCorresponding: false,
                dataSnapshot: {
                  fullName: coauthor.fullName,
                  organization: coauthor.organization,
                  emailCipher: encryptSecret(coauthor.email, config.ENCRYPTION_KEY),
                  emailHash: hashOpaqueToken(coauthor.email),
                },
              })),
            });
          }
          const metadataPayload = {
            articleTitle,
            articleType,
            articleLanguage,
            articleSection,
            abstract,
            keywords,
          };
          await tx.submissionMetadata.create({
            data: {
              submissionVersionId: version.id,
              manuscriptLanguage: articleLanguage,
              articleType,
              sectionCode: articleSection,
              titles: { [articleLanguage]: articleTitle },
              abstracts: { [articleLanguage]: abstract },
              keywords: { [articleLanguage]: keywords },
              fingerprint: hashOpaqueToken(JSON.stringify(metadataPayload)),
            },
          });
          await persistFiles(version.id, 1);
          await tx.statusHistory.create({
            data: {
              submissionId: submission.id,
              fromStatus: 'DRAFT',
              toStatus: 'SUBMITTED',
              actorType: 'USER',
              actorId: user.id,
              actorRole: 'AUTHOR',
              correlationId: request.id,
            },
          });
          await tx.notification.create({
            data: {
              eventId: randomUUID(),
              submissionId: submission.id,
              userId: user.id,
              eventCode: 'submission.submitted',
              locale: user.locale ?? 'uz_Latn',
              templateVersion: 'static-v1',
              templateSnapshot: { key: 'notification.submitted' },
              variables: { public_id: publicId },
            },
          });
          const receipt = await createReceipt({
            submissionVersionId: version.id,
            submissionVersionNo: 1,
            publicId,
            status: 'SUBMITTED',
            submittedAt: submission.submittedAt,
          });
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(4815162342)`;
          const previousAudit = await tx.auditLog.findFirst({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { eventHash: true },
          });
          const eventHash = hashOpaqueToken(
            JSON.stringify({
              previous: previousAudit?.eventHash ?? null,
              action: 'submission.created',
              submissionId: submission.id,
              actorId: user.id,
              requestId: request.id,
            }),
          );
          await tx.auditLog.create({
            data: {
              actorType: 'USER',
              actorId: user.id,
              actorRole: 'AUTHOR',
              action: 'submission.created',
              entity: 'Submission',
              entityId: submission.id,
              journalId: draft.journal.id,
              after: {
                publicId,
                status: 'SUBMITTED',
                requirementVersionId: draft.requirementVersion.id,
              },
              outcome: 'SUCCESS',
              ipHash: hashOpaqueToken(request.ip),
              userAgentHash: hashOpaqueToken(request.headers['user-agent'] ?? ''),
              requestId: request.id,
              correlationId: request.id,
              prevHash: previousAudit?.eventHash ?? null,
              eventHash,
            },
          });
          await tx.draft.update({
            where: { id: draft.id },
            data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
          });
          return completeIdempotency({
            submissionId: submission.id,
            publicId,
            status: 'SUBMITTED' as const,
            submittedAt: submission.submittedAt,
            receiptJobId: receipt.id,
          });
        },
        {
          lockAuditChain: true,
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
      if (!result)
        return reply.code(409).send({
          code: 'STALE_ACTION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      return reply.code(201).send(result);
    },
  );

  app.post(
    '/api/v1/internal/telegram/users/:telegramUserId/submissions/:submissionId/revision-draft',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), submissionId: z.uuid() })
        .parse(request.params);
      const user = await telegramUser(params.telegramUserId);
      if (!user)
        return reply.code(404).send({
          code: 'NOT_FOUND',
          messageKey: 'error.system',
          correlationId: request.id,
        });
      const submission = await database.submission.findFirst({
        where: {
          id: params.submissionId,
          ownerId: user.id,
          status: { in: ['NEEDS_CORRECTION', 'REVISION_REQUESTED'] },
          deletedAt: null,
        },
        include: {
          owner: { include: { authorProfile: true } },
          versions: {
            orderBy: { versionNo: 'desc' },
            take: 1,
            include: { metadata: true, authors: { orderBy: { authorOrder: 'asc' } } },
          },
        },
      });
      const profile = submission?.owner.authorProfile;
      const latest = submission?.versions[0];
      if (!submission || !profile || !latest?.metadata)
        return reply.code(409).send({
          code: 'REVISION_NOT_AVAILABLE',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      const firstString = (value: Prisma.JsonValue): string => {
        if (typeof value !== 'object' || !value || Array.isArray(value)) return '';
        const found = Object.values(value).find((entry) => typeof entry === 'string');
        return typeof found === 'string' ? found : '';
      };
      const firstKeywords = (value: Prisma.JsonValue): string => {
        if (typeof value !== 'object' || !value || Array.isArray(value)) return '';
        const found = Object.values(value).find((entry) => Array.isArray(entry));
        return Array.isArray(found)
          ? found.filter((entry) => typeof entry === 'string').join(', ')
          : '';
      };
      const coauthors =
        latest.authors
          .slice(1)
          .map((author) => {
            const data = draftContext(author.dataSnapshot);
            const emailCipher = typeof data.emailCipher === 'string' ? data.emailCipher : '';
            return `${typeof data.fullName === 'string' ? data.fullName : ''} | ${emailCipher ? decryptSecret(emailCipher, config.ENCRYPTION_KEY) : ''} | ${typeof data.organization === 'string' ? data.organization : ''}`;
          })
          .join('\n') || '-';
      await database.draft.updateMany({
        where: { userId: user.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      const draft = await database.draft.create({
        data: {
          userId: user.id,
          journalId: submission.journalId,
          requirementVersionId: submission.requirementVersionId,
          machineState: 'FILE_ARTICLE',
          expectedInputType: 'DOCUMENT',
          expiresAt: new Date(Date.now() + config.RETENTION_DRAFT_DAYS * 24 * 60 * 60_000),
          context: {
            revisionSubmissionId: submission.id,
            firstName: profile.firstName,
            lastName: profile.lastName,
            middleName: profile.middleName ?? '-',
            phone: decryptSecret(profile.phoneCipher, config.ENCRYPTION_KEY),
            email: decryptSecret(profile.emailCipher, config.ENCRYPTION_KEY),
            organization: profile.organization,
            position: profile.position,
            degree: profile.degree ?? '-',
            academicTitle: profile.academicTitle ?? '-',
            country: profile.country ?? '-',
            city: profile.city ?? '-',
            orcid: profile.orcid ?? '-',
            coauthors,
            articleTitle: firstString(latest.metadata.titles),
            articleType: latest.metadata.articleType,
            articleLanguage: latest.metadata.manuscriptLanguage,
            articleSection: latest.metadata.sectionCode,
            abstract: firstString(latest.metadata.abstracts),
            keywords: firstKeywords(latest.metadata.keywords),
            requirementsAcknowledgedAt: new Date().toISOString(),
          },
        },
        include: hydratedDraftInclude,
      });
      return reply.code(201).send(draft);
    },
  );

  app.get(
    '/api/v1/internal/telegram/users/:telegramUserId/submissions',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const user = await telegramUser(telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const items = await database.submission.findMany({
        where: { ownerId: user.id, deletedAt: null },
        include: { journal: { select: { code: true } } },
        orderBy: { submittedAt: 'desc' },
        take: 50,
      });
      return {
        items: items.map((item) => ({
          id: item.id,
          publicId: item.publicId,
          status: item.status,
          rowVersion: item.rowVersion,
          currentVersionNo: item.currentVersionNo,
          journalCode: item.journal.code,
          updatedAt: item.submittedAt,
        })),
      };
    },
  );

  app.get(
    '/api/v1/internal/telegram/users/:telegramUserId/submissions/:submissionId',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), submissionId: z.uuid() })
        .parse(request.params);
      const user = await telegramUser(params.telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const submission = await database.submission.findFirst({
        where: { id: params.submissionId, ownerId: user.id, deletedAt: null },
        select: {
          id: true,
          publicId: true,
          status: true,
          currentVersionNo: true,
          submittedAt: true,
          journal: { select: { code: true } },
          requirementVersion: { select: { version: true, config: true } },
          statusHistory: {
            where: { publicReason: { not: null } },
            select: { toStatus: true, publicReason: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          messageThread: {
            select: {
              messages: {
                where: { visibility: 'PUBLIC' },
                select: { body: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
                take: 10,
              },
            },
          },
          versions: {
            select: {
              versionNo: true,
              createdAt: true,
              files: {
                where: { category: { not: 'ANONYMIZED_MANUSCRIPT' } },
                select: {
                  category: true,
                  required: true,
                  versionNo: true,
                  createdAt: true,
                  file: {
                    select: {
                      id: true,
                      originalName: true,
                      extension: true,
                      sizeBytes: true,
                      sha256: true,
                      scanStatus: true,
                      storageStatus: true,
                    },
                  },
                },
                orderBy: [{ category: 'asc' }, { versionNo: 'desc' }],
              },
            },
            orderBy: { versionNo: 'desc' },
          },
        },
      });
      if (!submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      return submission;
    },
  );

  app.get(
    '/api/v1/internal/telegram/users/:telegramUserId/files/:fileId/download',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), fileId: z.uuid() })
        .parse(request.params);
      const user = await telegramUser(params.telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const file = await database.fileAsset.findFirst({
        where: {
          id: params.fileId,
          deletedAt: null,
          scanStatus: 'CLEAN',
          storageStatus: 'STORED',
          submissionLinks: {
            some: {
              category: { not: 'ANONYMIZED_MANUSCRIPT' },
              submissionVersion: {
                submission: { ownerId: user.id, deletedAt: null },
              },
            },
          },
        },
        select: {
          id: true,
          objectKey: true,
          originalName: true,
          extension: true,
          detectedMime: true,
          submissionLinks: {
            where: {
              category: { not: 'ANONYMIZED_MANUSCRIPT' },
              submissionVersion: {
                submission: { ownerId: user.id, deletedAt: null },
              },
            },
            select: {
              submissionVersion: {
                select: { submission: { select: { id: true, journalId: true } } },
              },
            },
            take: 1,
          },
        },
      });
      const ownedSubmission = file?.submissionLinks[0]?.submissionVersion.submission;
      if (!file?.objectKey || !ownedSubmission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: file.objectKey,
          ResponseContentDisposition: `attachment; filename="download.${file.extension ?? 'bin'}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
          ResponseContentType: file.detectedMime ?? 'application/octet-stream',
        }),
        { expiresIn: config.SIGNED_URL_TTL_SECONDS },
      );
      await database.$transaction(async (tx) =>
        appendAudit(tx, request, {
          action: 'file.download_url.issued',
          entity: 'FileAsset',
          entityId: file.id,
          journalId: ownedSubmission.journalId,
          after: {
            submissionId: ownedSubmission.id,
            expiresInSeconds: config.SIGNED_URL_TTL_SECONDS,
          },
          actor: { type: 'USER', id: user.id, role: 'AUTHOR' },
        }),
      );
      return { url, expiresInSeconds: config.SIGNED_URL_TTL_SECONDS };
    },
  );

  app.get(
    '/api/v1/internal/telegram/users/:telegramUserId/submissions/:submissionId/receipt',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const params = z
        .object({ telegramUserId: z.string().regex(/^\d+$/), submissionId: z.uuid() })
        .parse(request.params);
      const user = await telegramUser(params.telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const submission = await database.submission.findFirst({
        where: { id: params.submissionId, ownerId: user.id, deletedAt: null },
        select: { id: true, journalId: true, currentVersionNo: true },
      });
      if (!submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const receipt = await database.submissionReceipt.findFirst({
        where: {
          submissionVersion: {
            submissionId: submission.id,
            versionNo: submission.currentVersionNo,
          },
        },
        include: { file: true, submissionVersion: { select: { versionNo: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (!receipt)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (
        receipt.status !== 'READY' ||
        !receipt.file?.objectKey ||
        receipt.file.storageStatus !== 'STORED' ||
        receipt.file.deletedAt
      )
        return {
          status: receipt.status,
          submissionVersion: receipt.submissionVersion.versionNo,
        };
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: receipt.file.objectKey,
          ResponseContentDisposition: `attachment; filename="${receipt.file.originalName}"`,
          ResponseContentType: 'application/pdf',
        }),
        { expiresIn: config.SIGNED_URL_TTL_SECONDS },
      );
      await database.$transaction(async (tx) =>
        appendAudit(tx, request, {
          action: 'submission.receipt.download_url.issued',
          entity: 'SubmissionReceipt',
          entityId: receipt.id,
          journalId: submission.journalId,
          after: {
            submissionId: submission.id,
            submissionVersion: receipt.submissionVersion.versionNo,
            expiresInSeconds: config.SIGNED_URL_TTL_SECONDS,
          },
          actor: { type: 'USER', id: user.id, role: 'AUTHOR' },
        }),
      );
      return {
        status: receipt.status,
        submissionVersion: receipt.submissionVersion.versionNo,
        url,
        expiresInSeconds: config.SIGNED_URL_TTL_SECONDS,
      };
    },
  );

  app.get(
    '/api/v1/internal/telegram/users/:telegramUserId/notifications',
    { preHandler: authenticateService, schema: { hide: true } },
    async (request, reply) => {
      const telegramUserId = z
        .string()
        .regex(/^\d+$/)
        .parse((request.params as { telegramUserId: string }).telegramUserId);
      const user = await telegramUser(telegramUserId);
      if (!user)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const items = await database.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          eventCode: true,
          status: true,
          createdAt: true,
          variables: true,
          templateSnapshot: true,
        },
      });
      return { items };
    },
  );

  app.get(
    '/api/v1/admin/journals',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Journals'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      requirePermission(request.actor!, 'journal:read');
      const rows = await database.journal.findMany({
        where: { retiredAt: null },
        include: {
          localizations: true,
          currentRequirement: { include: { localizations: true } },
          requirementVersions: {
            select: {
              id: true,
              version: true,
              state: true,
              rowVersion: true,
              createdAt: true,
              createdById: true,
            },
            orderBy: { version: 'desc' },
          },
          _count: { select: { submissions: true, requirementVersions: true } },
        },
        orderBy: { code: 'asc' },
      });
      return { items: rows };
    },
  );

  app.post(
    '/api/v1/admin/journals',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Journals'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      requirePermission(request.actor!, 'journal:configure');
      const localization = z
        .object({
          name: z.string().min(1).max(500),
          shortName: z.string().min(1).max(200),
          description: z.string().min(1).max(20_000),
          contactText: z.string().max(10_000).optional(),
        })
        .strict();
      const body = z
        .object({
          code: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z0-9_-]{2,16}$/),
          mode: z.enum(['NATIVE', 'EXTERNAL_LINK', 'API_SYNC', 'CLOSED']),
          externalUrl: z.url().optional(),
          fourEyesRequired: z.boolean().default(true),
          localizations: z
            .object({ 'uz-Latn': localization, ru: localization, en: localization })
            .strict(),
        })
        .strict()
        .parse(request.body);
      if ((body.mode === 'EXTERNAL_LINK' || body.mode === 'API_SYNC') && !body.externalUrl)
        return reply.code(422).send({
          code: 'EXTERNAL_URL_REQUIRED',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const journal = await database.$transaction(async (tx) => {
        const created = await tx.journal.create({
          data: {
            code: body.code,
            mode: body.mode,
            externalUrl: body.externalUrl ?? null,
            fourEyesRequired: body.fourEyesRequired,
            localizations: {
              create: Object.entries(body.localizations).map(([locale, value]) => ({
                locale: databaseLocale(locale as Locale),
                ...value,
                contactText: value.contactText ?? null,
              })),
            },
          },
          include: { localizations: true },
        });
        if (!hasJournalScope(request.actor!, created.id))
          await tx.employeeJournalScope.create({
            data: {
              employeeId: request.actor!.id,
              journalId: created.id,
              grantedBy: request.actor!.id,
            },
          });
        await appendAudit(tx, request, {
          action: 'journal.created',
          entity: 'Journal',
          entityId: created.id,
          journalId: created.id,
          after: created,
        });
        return created;
      });
      return reply.code(201).send(journal);
    },
  );

  app.patch(
    '/api/v1/admin/journals/:id',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Journals'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      requirePermission(request.actor!, 'journal:configure');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const localization = z
        .object({
          name: z.string().trim().min(1).max(500),
          shortName: z.string().trim().min(1).max(200),
          description: z.string().trim().min(1).max(20_000),
          contactText: z.string().trim().max(10_000).nullable().optional(),
        })
        .strict();
      const body = z
        .object({
          mode: z.enum(['NATIVE', 'EXTERNAL_LINK', 'API_SYNC', 'CLOSED', 'ARCHIVED']).optional(),
          active: z.boolean().optional(),
          externalUrl: z.url().nullable().optional(),
          fourEyesRequired: z.boolean().optional(),
          acceptanceOpensAt: z.iso.datetime().nullable().optional(),
          acceptanceClosesAt: z.iso.datetime().nullable().optional(),
          localizations: z
            .object({ 'uz-Latn': localization, ru: localization, en: localization })
            .strict()
            .optional(),
          expectedUpdatedAt: z.iso.datetime(),
        })
        .strict()
        .parse(request.body);
      const before = await database.journal.findUnique({
        where: { id },
        include: { localizations: true },
      });
      if (!before)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(request.actor!, before.id))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      const resultingMode = body.mode ?? before.mode;
      const resultingExternalUrl =
        body.externalUrl === undefined ? before.externalUrl : body.externalUrl;
      if (
        (resultingMode === 'EXTERNAL_LINK' || resultingMode === 'API_SYNC') &&
        !resultingExternalUrl
      )
        throw new BusinessRuleError('EXTERNAL_URL_REQUIRED', 'validation.required', 422);
      const opensAt =
        body.acceptanceOpensAt === undefined
          ? before.acceptanceOpensAt
          : body.acceptanceOpensAt
            ? new Date(body.acceptanceOpensAt)
            : null;
      const closesAt =
        body.acceptanceClosesAt === undefined
          ? before.acceptanceClosesAt
          : body.acceptanceClosesAt
            ? new Date(body.acceptanceClosesAt)
            : null;
      if (opensAt && closesAt && opensAt >= closesAt)
        throw new BusinessRuleError('ACCEPTANCE_WINDOW_INVALID', 'validation.required', 422);
      if (before.updatedAt.toISOString() !== body.expectedUpdatedAt)
        return reply.code(409).send({
          code: 'STALE_ACTION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      const updated = await database.$transaction(async (tx) => {
        const mutation = await tx.journal.updateMany({
          where: { id, updatedAt: before.updatedAt },
          data: {
            ...(body.mode !== undefined ? { mode: body.mode } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.externalUrl !== undefined ? { externalUrl: body.externalUrl } : {}),
            ...(body.fourEyesRequired !== undefined
              ? { fourEyesRequired: body.fourEyesRequired }
              : {}),
            ...(body.acceptanceOpensAt !== undefined
              ? {
                  acceptanceOpensAt: body.acceptanceOpensAt
                    ? new Date(body.acceptanceOpensAt)
                    : null,
                }
              : {}),
            ...(body.acceptanceClosesAt !== undefined
              ? {
                  acceptanceClosesAt: body.acceptanceClosesAt
                    ? new Date(body.acceptanceClosesAt)
                    : null,
                }
              : {}),
            ...(body.localizations ? { updatedAt: new Date() } : {}),
          },
        });
        if (mutation.count !== 1) throw new Error('CONCURRENT_UPDATE');
        if (body.localizations) {
          for (const [locale, value] of Object.entries(body.localizations)) {
            const databaseLocaleValue = databaseLocale(locale as Locale);
            await tx.journalLocalization.upsert({
              where: { journalId_locale: { journalId: id, locale: databaseLocaleValue } },
              update: {
                name: value.name,
                shortName: value.shortName,
                description: value.description,
                contactText: value.contactText ?? null,
              },
              create: {
                journalId: id,
                locale: databaseLocaleValue,
                name: value.name,
                shortName: value.shortName,
                description: value.description,
                contactText: value.contactText ?? null,
              },
            });
          }
        }
        const after = await tx.journal.findUniqueOrThrow({
          where: { id },
          include: { localizations: true },
        });
        await appendAudit(tx, request, {
          action: 'journal.updated',
          entity: 'Journal',
          entityId: id,
          journalId: id,
          before,
          after,
        });
        return after;
      });
      return updated;
    },
  );

  app.post(
    '/api/v1/admin/journals/:id/requirements',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Requirements'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      requirePermission(request.actor!, 'journal:configure');
      const journalId = z.uuid().parse((request.params as { id: string }).id);
      const localization = z
        .object({
          title: z.string().min(1).max(500),
          summary: z.string().min(1).max(20_000),
          body: z.string().min(1).max(200_000),
          help: z.string().max(50_000).optional(),
          contact: z.string().max(10_000).optional(),
        })
        .strict();
      const body = z
        .object({
          config: z.unknown(),
          changeNote: z.string().min(1).max(2_000),
          localizations: z
            .object({ 'uz-Latn': localization, ru: localization, en: localization })
            .strict(),
        })
        .strict()
        .parse(request.body);
      const journal = await database.journal.findUnique({ where: { id: journalId } });
      if (!journal)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(request.actor!, journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      const validatedConfig = journalRequirementConfigSchema.parse(body.config);
      const configValue = JSON.parse(JSON.stringify(validatedConfig)) as Prisma.InputJsonValue;
      const configHash = hashOpaqueToken(JSON.stringify(configValue));
      const result = await database.$transaction(async (tx) => {
        const latest = await tx.journalRequirementVersion.findFirst({
          where: { journalId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const requirement = await tx.journalRequirementVersion.create({
          data: {
            journalId,
            version: (latest?.version ?? 0) + 1,
            config: configValue,
            configHash,
            changeNote: body.changeNote,
            createdById: request.actor!.id,
            localizations: {
              create: Object.entries(body.localizations).map(([locale, value]) => ({
                locale: databaseLocale(locale as Locale),
                ...value,
                help: value.help ?? null,
                contact: value.contact ?? null,
              })),
            },
          },
          include: { localizations: true },
        });
        await appendAudit(tx, request, {
          action: 'journal.requirement.created',
          entity: 'JournalRequirementVersion',
          entityId: requirement.id,
          journalId,
          after: requirement,
        });
        return requirement;
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    '/api/v1/admin/requirements/:id/state',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Requirements'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const id = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({
          targetState: z.enum(['REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED']),
          expectedRowVersion: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.body);
      const requirement = await database.journalRequirementVersion.findUnique({ where: { id } });
      if (!requirement)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (body.targetState === 'REVIEW') requirePermission(request.actor!, 'journal:configure');
      else requirePermission(request.actor!, 'journal:approve');
      if (!hasJournalScope(request.actor!, requirement.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      const allowed: Record<string, readonly string[]> = {
        DRAFT: ['REVIEW'],
        REVIEW: ['DRAFT', 'APPROVED'],
        APPROVED: ['PUBLISHED'],
        PUBLISHED: ['RETIRED'],
        RETIRED: [],
      };
      if (!allowed[requirement.state]?.includes(body.targetState))
        return reply.code(409).send({
          code: 'INVALID_TRANSITION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      if (body.targetState !== 'RETIRED') journalRequirementConfigSchema.parse(requirement.config);
      if (body.targetState === 'APPROVED' && requirement.createdById === request.actor!.id)
        return reply.code(409).send({
          code: 'FOUR_EYES_REQUIRED',
          messageKey: 'error.forbidden',
          correlationId: request.id,
        });
      const result = await database.$transaction(async (tx) => {
        const mutation = await tx.journalRequirementVersion.updateMany({
          where: { id, rowVersion: body.expectedRowVersion, state: requirement.state },
          data: {
            state: body.targetState,
            rowVersion: { increment: 1 },
            ...(body.targetState === 'APPROVED' ? { approvedById: request.actor!.id } : {}),
            ...(body.targetState === 'PUBLISHED'
              ? { publishedAt: new Date(), effectiveAt: new Date() }
              : {}),
            ...(body.targetState === 'RETIRED' ? { retiredAt: new Date() } : {}),
          },
        });
        if (mutation.count !== 1) throw new Error('CONCURRENT_UPDATE');
        if (body.targetState === 'PUBLISHED')
          await tx.journal.update({
            where: { id: requirement.journalId },
            data: { currentRequirementId: id },
          });
        const after = await tx.journalRequirementVersion.findUniqueOrThrow({ where: { id } });
        await appendAudit(tx, request, {
          action: 'journal.requirement.state_changed',
          entity: 'JournalRequirementVersion',
          entityId: id,
          journalId: requirement.journalId,
          before: requirement,
          after,
        });
        return after;
      });
      return result;
    },
  );

  app.get(
    '/api/v1/admin/submissions',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Submissions'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      const actor = request.actor!;
      if (!hasPermission(actor.role, 'submission:read:journal')) {
        throw new TransitionDeniedError('FORBIDDEN', ['submission:read:journal']);
      }
      const query = z
        .object({
          status: z.enum(submissionStatuses).optional(),
          journalId: z.uuid().optional(),
          q: z.string().trim().min(1).max(200).optional(),
          cursor: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        })
        .parse(request.query);
      if (query.journalId && !hasJournalScope(actor, query.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      const search = query.q;
      const titleFilters: Prisma.SubmissionWhereInput[] = search
        ? ['uz-Latn', 'uz', 'ru', 'en'].map((locale) => ({
            versions: {
              some: {
                metadata: {
                  is: { titles: { path: [locale], string_contains: search } },
                },
              },
            },
          }))
        : [];
      const submissionWhere: Prisma.SubmissionWhereInput = {
        ...(query.journalId
          ? { journalId: query.journalId }
          : { journalId: { in: [...actor.journalIds] } }),
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { publicId: { contains: search, mode: 'insensitive' as const } },
                ...titleFilters,
              ],
            }
          : {}),
        deletedAt: null,
      };
      const rows = await database.submission.findMany({
        where: submissionWhere,
        include: { journal: { select: { code: true } } },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    },
  );

  app.get(
    '/api/v1/admin/submissions/:id',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Submissions'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'submission:read:journal');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const submission = await database.submission.findUnique({
        where: { id },
        include: {
          journal: { include: { localizations: true } },
          owner: { select: { id: true, locale: true, username: true } },
          requirementVersion: { include: { localizations: true } },
          versions: {
            orderBy: { versionNo: 'desc' },
            include: {
              metadata: true,
              authors: { orderBy: { authorOrder: 'asc' } },
              files: { include: { file: true } },
              receipts: {
                select: {
                  id: true,
                  locale: true,
                  status: true,
                  readyAt: true,
                  file: {
                    select: {
                      id: true,
                      originalName: true,
                      sizeBytes: true,
                      sha256: true,
                      storageStatus: true,
                    },
                  },
                },
              },
              preflightRuns: { orderBy: { createdAt: 'desc' } },
            },
          },
          statusHistory: { orderBy: { createdAt: 'desc' } },
          assignments: {
            include: { employee: { select: { displayName: true } } },
            orderBy: { assignedAt: 'desc' },
          },
          reviewAssignments: {
            include: {
              reviewer: { include: { employee: { select: { displayName: true } } } },
              review: true,
            },
            orderBy: { assignedAt: 'desc' },
          },
          decisionProposals: {
            include: {
              preparedBy: { select: { displayName: true } },
              approvedBy: { select: { displayName: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          messageThread: {
            include: {
              messages: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
      });
      if (!submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(actor, submission.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      return submission;
    },
  );

  app.get(
    '/api/v1/admin/files/:id/download',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Files'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      const id = z.uuid().parse((request.params as { id: string }).id);
      const file = await database.fileAsset.findUnique({
        where: { id },
        include: {
          submissionLinks: {
            include: { submissionVersion: { include: { submission: true } } },
          },
          reviewAssignments: {
            include: { reviewer: true, submission: true },
          },
          receipt: {
            include: { submissionVersion: { include: { submission: true } } },
          },
        },
      });
      if (!file || !file.objectKey || file.storageStatus !== 'STORED')
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const journalIds = new Set([
        ...file.submissionLinks.map((item) => item.submissionVersion.submission.journalId),
        ...file.reviewAssignments.map((item) => item.submission.journalId),
        ...(file.receipt ? [file.receipt.submissionVersion.submission.journalId] : []),
      ]);
      const canReadJournalFile =
        hasPermission(actor.role, 'file:read:journal') &&
        [...journalIds].some((journalId) => hasJournalScope(actor, journalId));
      const canReadAssignedAnonymized =
        hasPermission(actor.role, 'file:read:anonymized') &&
        file.reviewAssignments.some((assignment) => assignment.reviewer.employeeId === actor.id);
      if (!canReadJournalFile && !canReadAssignedAnonymized)
        throw new TransitionDeniedError('FORBIDDEN');
      const authorizedJournalId = [...journalIds][0];
      if (!authorizedJournalId) throw new TransitionDeniedError('FORBIDDEN');
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: file.objectKey,
          ResponseContentDisposition: `attachment; filename="download.${file.extension ?? 'bin'}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
          ResponseContentType: file.detectedMime ?? 'application/octet-stream',
        }),
        { expiresIn: config.SIGNED_URL_TTL_SECONDS },
      );
      await database.$transaction(async (tx) =>
        appendAudit(tx, request, {
          action: 'file.download_url.issued',
          entity: 'FileAsset',
          entityId: file.id,
          journalId: authorizedJournalId,
          after: { expiresInSeconds: config.SIGNED_URL_TTL_SECONDS },
        }),
      );
      return { url, expiresInSeconds: config.SIGNED_URL_TTL_SECONDS };
    },
  );

  app.post(
    '/api/v1/admin/submissions/:id/assignments',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Assignments'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'submission:assign');
      const submissionId = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({
          employeeId: z.uuid(),
          kind: z.enum(['OPERATOR', 'EDITOR']),
          reason: z.string().trim().min(1).max(2_000),
          deadline: z.iso.datetime().optional(),
        })
        .strict()
        .parse(request.body);
      if (body.deadline && new Date(body.deadline) <= new Date())
        throw new BusinessRuleError('DEADLINE_MUST_BE_FUTURE', 'validation.required', 422);
      const [submission, employee] = await Promise.all([
        database.submission.findUnique({ where: { id: submissionId } }),
        database.employee.findUnique({
          where: { id: body.employeeId },
          include: { roles: { include: { role: true } }, journalScopes: true },
        }),
      ]);
      if (!submission || !employee)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(actor, submission.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      const requiredRole = body.kind;
      if (
        employee.status !== 'ACTIVE' ||
        !employee.roles.some((membership) => membership.role.code === requiredRole) ||
        !employee.journalScopes.some((scope) => scope.journalId === submission.journalId)
      )
        return reply.code(422).send({
          code: 'ASSIGNEE_INELIGIBLE',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const assignment = await database.$transaction(async (tx) => {
        await tx.assignment.updateMany({
          where: {
            submissionId,
            kind: body.kind,
            status: { in: ['PENDING', 'ACCEPTED'] },
          },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
        const created = await tx.assignment.create({
          data: {
            submissionId,
            employeeId: employee.id,
            journalId: submission.journalId,
            kind: body.kind,
            reason: body.reason,
            assignedById: actor.id,
            ...(body.deadline ? { deadline: new Date(body.deadline) } : {}),
          },
        });
        await appendAudit(tx, request, {
          action: 'submission.assignment.created',
          entity: 'Assignment',
          entityId: created.id,
          journalId: submission.journalId,
          after: created,
        });
        return created;
      });
      return reply.code(201).send(assignment);
    },
  );

  app.get(
    '/api/v1/admin/submissions/:id/assignment-options',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Assignments'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      const canAssignStaff = hasPermission(actor.role, 'submission:assign');
      const canAssignReviewers = hasPermission(actor.role, 'review:assign');
      if (!canAssignStaff && !canAssignReviewers) throw new TransitionDeniedError('FORBIDDEN');
      const submissionId = z.uuid().parse((request.params as { id: string }).id);
      const submission = await database.submission.findUnique({
        where: { id: submissionId },
        include: {
          versions: {
            orderBy: { versionNo: 'desc' },
            take: 1,
            include: {
              files: {
                where: {
                  category: 'ANONYMIZED_MANUSCRIPT',
                  file: { scanStatus: 'CLEAN', storageStatus: 'STORED' },
                },
                include: { file: { select: { id: true, originalName: true } } },
              },
              preflightRuns: {
                where: {
                  ruleSetVersion: 'anonymization-pf015-v1',
                  status: 'COMPLETED',
                  blockingCount: 0,
                  errorCount: 0,
                },
                select: { fileId: true },
              },
            },
          },
        },
      });
      if (!submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(actor, submission.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      const employees = canAssignStaff
        ? await database.employee.findMany({
            where: {
              status: 'ACTIVE',
              journalScopes: { some: { journalId: submission.journalId } },
              roles: { some: { role: { code: { in: ['OPERATOR', 'EDITOR'] } } } },
            },
            select: {
              id: true,
              displayName: true,
              roles: { select: { role: { select: { code: true } } } },
            },
            orderBy: { displayName: 'asc' },
          })
        : [];
      const reviewers = canAssignReviewers
        ? await database.reviewerProfile.findMany({
            where: { active: true, employee: { status: 'ACTIVE' } },
            select: {
              id: true,
              affiliation: true,
              employee: { select: { displayName: true } },
            },
            orderBy: { employee: { displayName: 'asc' } },
          })
        : [];
      const approvedPackageIds = new Set(
        submission.versions[0]?.preflightRuns.map((run) => run.fileId) ?? [],
      );
      return {
        employees: employees.map((employee) => ({
          id: employee.id,
          displayName: employee.displayName,
          roles: employee.roles.map((membership) => membership.role.code),
        })),
        reviewers,
        files:
          submission.versions[0]?.files
            .filter((item) => approvedPackageIds.has(item.file.id))
            .map((item) => item.file) ?? [],
      };
    },
  );

  app.post(
    '/api/v1/admin/submissions/:id/anonymized-files',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: {
        tags: ['Reviews', 'Files'],
        consumes: ['multipart/form-data'],
        security: [{ staffCookie: [] }],
      },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'review:assign');
      if (request.headers['x-anonymization-attested'] !== 'true')
        throw new BusinessRuleError(
          'ANONYMIZATION_ATTESTATION_REQUIRED',
          'validation.required',
          422,
        );
      const submissionId = z.uuid().parse((request.params as { id: string }).id);
      const submission = await database.submission.findUnique({ where: { id: submissionId } });
      if (!submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(actor, submission.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      if (!['REGISTERED', 'EDITORIAL_REVIEW', 'UNDER_REVIEW'].includes(submission.status))
        throw new BusinessRuleError('ANONYMIZED_UPLOAD_STATE_INVALID', 'error.stale_action', 409);

      const upload = await request.file({
        limits: { fileSize: config.FILE_MAX_BYTES, files: 1, fields: 0, parts: 1 },
      });
      if (!upload) throw new BusinessRuleError('FILE_REQUIRED', 'validation.required', 422);
      const originalName = z
        .string()
        .trim()
        .min(1)
        .max(255)
        .parse(sanitizeFileName(upload.filename));
      const extension = fileExtension(originalName);
      if (!extension || !['docx', 'pdf'].includes(extension))
        throw new BusinessRuleError('FILE_FORMAT', 'error.file_format', 422);
      const fileAssetId = randomUUID();
      const quarantinePath = join(config.FILE_QUARANTINE_DIR, `${fileAssetId}.upload`);
      await mkdir(config.FILE_QUARANTINE_DIR, { recursive: true, mode: 0o700 });
      try {
        await pipeline(
          upload.file,
          createWriteStream(quarantinePath, { flags: 'wx', mode: 0o600 }),
        );
        if (upload.file.truncated)
          throw new BusinessRuleError('FILE_TOO_LARGE', 'error.file_size', 422);
        const received = await stat(quarantinePath);
        if (received.size < 1 || received.size > config.FILE_MAX_BYTES)
          throw new BusinessRuleError('FILE_SIZE_INVALID', 'error.file_size', 422);

        const result = await serializableTransactionWithRetry(
          database,
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`anonymized-upload:${submissionId}`}, 0))`;
            const current = await tx.submission.findUniqueOrThrow({
              where: { id: submissionId },
              include: {
                versions: {
                  where: { versionNo: submission.currentVersionNo },
                  take: 1,
                  select: { id: true },
                },
              },
            });
            if (current.currentVersionNo !== submission.currentVersionNo)
              throw new BusinessRuleError('STALE_ACTION', 'error.stale_action', 409);
            const submissionVersionId = current.versions[0]?.id;
            if (!submissionVersionId) throw new Error('SUBMISSION_VERSION_NOT_FOUND');
            const latest = await tx.submissionFile.aggregate({
              where: { submissionVersionId, category: 'ANONYMIZED_MANUSCRIPT' },
              _max: { versionNo: true },
            });
            const versionNo = (latest._max.versionNo ?? 0) + 1;
            await tx.fileAsset.create({
              data: {
                id: fileAssetId,
                sourceKey: `admin-derived:${fileAssetId}`,
                originalName,
                declaredMime: upload.mimetype,
                extension,
                sizeBytes: BigInt(received.size),
                storageStatus: 'QUARANTINED',
                quarantineKey: `local:api/${fileAssetId}`,
                provenance: {
                  provider: 'admin-derived-upload',
                  uploadedById: actor.id,
                  submissionId,
                  anonymizationAttested: true,
                },
              },
            });
            await tx.submissionFile.create({
              data: {
                submissionVersionId,
                fileId: fileAssetId,
                category: 'ANONYMIZED_MANUSCRIPT',
                required: false,
                versionNo,
              },
            });
            await tx.preflightRun.create({
              data: {
                submissionVersionId,
                fileId: fileAssetId,
                status: 'PENDING',
                ruleSetVersion: 'anonymization-pf015-v1',
                toolVersion: 'hmqa-anonymization-preflight-1',
              },
            });
            await appendAudit(tx, request, {
              action: 'review.anonymized_file.uploaded',
              entity: 'FileAsset',
              entityId: fileAssetId,
              journalId: submission.journalId,
              after: {
                submissionId,
                submissionVersionId,
                category: 'ANONYMIZED_MANUSCRIPT',
                versionNo,
                sizeBytes: received.size,
                extension,
                anonymizationAttested: true,
              },
            });
            return { submissionVersionId, versionNo };
          },
          { lockAuditChain: true },
        );
        await fileQueue.add(
          jobNames.ingestTelegramFile,
          { fileAssetId },
          { jobId: `file-${fileAssetId}` },
        );
        return reply.code(202).send({
          fileAssetId,
          submissionVersionId: result.submissionVersionId,
          versionNo: result.versionNo,
          scanStatus: 'PENDING',
        });
      } catch (error) {
        const created = await database.fileAsset
          .findUnique({ where: { id: fileAssetId }, select: { id: true } })
          .catch(() => null);
        if (!created) await rm(quarantinePath, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/admin/submissions/:id/reviewer-assignments',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Reviews'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'review:assign');
      const submissionId = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({
          reviewerId: z.uuid(),
          anonymizedFileId: z.uuid(),
          deadline: z.iso.datetime(),
        })
        .strict()
        .parse(request.body);
      if (new Date(body.deadline) <= new Date())
        throw new BusinessRuleError('DEADLINE_MUST_BE_FUTURE', 'validation.required', 422);
      const [submission, reviewer, file, anonymizationRun] = await Promise.all([
        database.submission.findUnique({ where: { id: submissionId } }),
        database.reviewerProfile.findUnique({
          where: { id: body.reviewerId },
          include: { employee: true },
        }),
        database.submissionFile.findFirst({
          where: {
            fileId: body.anonymizedFileId,
            category: 'ANONYMIZED_MANUSCRIPT',
            submissionVersion: { submissionId },
            file: { scanStatus: 'CLEAN', storageStatus: 'STORED' },
          },
        }),
        database.preflightRun.findFirst({
          where: {
            fileId: body.anonymizedFileId,
            ruleSetVersion: 'anonymization-pf015-v1',
            status: 'COMPLETED',
            blockingCount: 0,
            errorCount: 0,
            submissionVersion: { submissionId },
          },
        }),
      ]);
      if (!submission || !reviewer || !file || !anonymizationRun)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(actor, submission.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      if (!reviewer.active || reviewer.employee.status !== 'ACTIVE')
        return reply.code(422).send({
          code: 'REVIEWER_INELIGIBLE',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const activeDuplicate = await database.reviewAssignment.findFirst({
        where: {
          submissionId,
          reviewerId: reviewer.id,
          status: { in: ['PENDING', 'ACCEPTED'] },
        },
        select: { id: true },
      });
      if (activeDuplicate)
        throw new BusinessRuleError('REVIEWER_ALREADY_ASSIGNED', 'error.stale_action', 409);
      const assignment = await database.$transaction(async (tx) => {
        const created = await tx.reviewAssignment.create({
          data: {
            submissionId,
            reviewerId: reviewer.id,
            anonymizedFileId: body.anonymizedFileId,
            deadline: new Date(body.deadline),
          },
        });
        await appendAudit(tx, request, {
          action: 'review.assignment.created',
          entity: 'ReviewAssignment',
          entityId: created.id,
          journalId: submission.journalId,
          after: created,
        });
        return created;
      });
      return reply.code(201).send(assignment);
    },
  );

  app.post(
    '/api/v1/admin/submissions/:id/decisions',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Decisions'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'submission:decision:prepare');
      const submissionId = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({
          decision: z.enum(['ACCEPT', 'REJECT']),
          publicReason: z.string().trim().min(1).max(4_000),
          internalBasis: z.string().trim().min(1).max(4_000),
        })
        .strict()
        .parse(request.body);
      const submission = await database.submission.findUnique({ where: { id: submissionId } });
      if (!submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(actor, submission.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      if (!['EDITORIAL_REVIEW', 'UNDER_REVIEW'].includes(submission.status))
        return reply.code(409).send({
          code: 'INVALID_DECISION_STATE',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      const proposal = await database.$transaction(async (tx) => {
        await tx.decisionProposal.updateMany({
          where: { submissionId, status: 'PREPARED' },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
        const created = await tx.decisionProposal.create({
          data: { submissionId, preparedById: actor.id, ...body },
        });
        await appendAudit(tx, request, {
          action: 'submission.decision.prepared',
          entity: 'DecisionProposal',
          entityId: created.id,
          journalId: submission.journalId,
          after: created,
        });
        return created;
      });
      return reply.code(201).send(proposal);
    },
  );

  app.post(
    '/api/v1/admin/submissions/:id/messages',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Messages'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      if (
        !hasPermission(actor.role, 'submission:technical-review') &&
        !hasPermission(actor.role, 'submission:editorial-review')
      )
        throw new TransitionDeniedError('FORBIDDEN');
      const submissionId = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({
          visibility: z.enum(['PUBLIC', 'INTERNAL']),
          body: z.string().trim().min(1).max(20_000),
          locale: z.enum(['uz-Latn', 'ru', 'en']).optional(),
        })
        .strict()
        .parse(request.body);
      const submission = await database.submission.findUnique({
        where: { id: submissionId },
        include: { owner: true },
      });
      if (!submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (!hasJournalScope(actor, submission.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      const message = await database.$transaction(async (tx) => {
        const thread = await tx.messageThread.upsert({
          where: { submissionId },
          update: {},
          create: { submissionId, userId: submission.ownerId },
        });
        const created = await tx.message.create({
          data: {
            threadId: thread.id,
            visibility: body.visibility,
            actorType: 'EMPLOYEE',
            actorId: actor.id,
            body: body.body,
            ...(body.locale ? { locale: databaseLocale(body.locale) } : {}),
          },
        });
        if (body.visibility === 'PUBLIC') {
          await tx.notification.create({
            data: {
              eventId: randomUUID(),
              submissionId,
              userId: submission.ownerId,
              eventCode: 'submission.message.created',
              locale: submission.owner.locale ?? 'uz_Latn',
              templateVersion: 'static-v1',
              templateSnapshot: { key: 'notification.editor_message' },
              variables: { public_id: submission.publicId },
            },
          });
        }
        await appendAudit(tx, request, {
          action: 'submission.message.created',
          entity: 'Message',
          entityId: created.id,
          journalId: submission.journalId,
          after: { visibility: created.visibility, locale: created.locale },
        });
        return created;
      });
      return reply.code(201).send(message);
    },
  );

  app.get(
    '/api/v1/admin/reviews/assigned',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Reviews'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      requirePermission(request.actor!, 'review:read:assigned');
      const reviewer = await database.reviewerProfile.findUnique({
        where: { employeeId: request.actor!.id },
      });
      if (!reviewer) return { items: [] };
      return {
        items: await database.reviewAssignment.findMany({
          where: { reviewerId: reviewer.id, status: { not: 'CANCELLED' } },
          include: {
            submission: { select: { publicId: true, status: true, journalId: true } },
            review: true,
          },
          orderBy: { deadline: 'asc' },
        }),
      };
    },
  );

  app.post(
    '/api/v1/admin/review-assignments/:id/respond',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Reviews'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      requirePermission(request.actor!, 'review:write:assigned');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({ response: z.enum(['ACCEPTED', 'DECLINED']), conflictDeclared: z.boolean() })
        .strict()
        .parse(request.body);
      if (body.response === 'ACCEPTED' && body.conflictDeclared)
        return reply.code(422).send({
          code: 'CONFLICT_OF_INTEREST',
          messageKey: 'error.forbidden',
          correlationId: request.id,
        });
      const assignment = await database.reviewAssignment.findUnique({
        where: { id },
        include: { reviewer: true, submission: true },
      });
      if (!assignment || assignment.reviewer.employeeId !== request.actor!.id)
        throw new TransitionDeniedError('FORBIDDEN');
      const updated = await database.$transaction(async (tx) => {
        const mutation = await tx.reviewAssignment.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: body.response,
            conflictDeclared: body.conflictDeclared,
            ...(body.response === 'DECLINED' ? { completedAt: new Date() } : {}),
          },
        });
        if (mutation.count !== 1) throw new Error('CONCURRENT_UPDATE');
        const after = await tx.reviewAssignment.findUniqueOrThrow({ where: { id } });
        await appendAudit(tx, request, {
          action: `review.assignment.${body.response.toLowerCase()}`,
          entity: 'ReviewAssignment',
          entityId: id,
          journalId: assignment.submission.journalId,
          before: assignment,
          after,
        });
        return after;
      });
      return updated;
    },
  );

  app.post(
    '/api/v1/admin/review-assignments/:id/review',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Reviews'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      requirePermission(request.actor!, 'review:write:assigned');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({
          recommendation: z.enum(['ACCEPT', 'MINOR_REVISION', 'MAJOR_REVISION', 'REJECT']),
          publicComments: z.string().trim().min(1).max(20_000),
          confidentialComments: z.string().trim().max(20_000).optional(),
        })
        .strict()
        .parse(request.body);
      const assignment = await database.reviewAssignment.findUnique({
        where: { id },
        include: { reviewer: true, submission: true, review: true },
      });
      if (!assignment || assignment.reviewer.employeeId !== request.actor!.id)
        throw new TransitionDeniedError('FORBIDDEN');
      if (assignment.status !== 'ACCEPTED' || assignment.review)
        return reply.code(409).send({
          code: 'REVIEW_NOT_ACCEPTED',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      const review = await database.$transaction(async (tx) => {
        const created = await tx.review.create({
          data: {
            reviewAssignmentId: id,
            recommendation: body.recommendation,
            publicComments: body.publicComments,
            confidentialComments: body.confidentialComments ?? null,
          },
        });
        await tx.reviewAssignment.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await appendAudit(tx, request, {
          action: 'review.submitted',
          entity: 'Review',
          entityId: created.id,
          journalId: assignment.submission.journalId,
          after: {
            recommendation: created.recommendation,
            submittedAt: created.submittedAt,
          },
        });
        return created;
      });
      return reply.code(201).send(review);
    },
  );

  app.post(
    '/api/v1/admin/employees',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Users'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'user:manage');
      requirePermission(actor, 'role:manage');
      const body = z
        .object({
          email: z.email(),
          displayName: z.string().trim().min(2).max(200),
          role: z.enum([
            'OPERATOR',
            'EDITOR',
            'REVIEWER',
            'CHIEF_EDITOR',
            'CONTENT_ADMIN',
            'ADMIN',
            'AUDITOR',
          ]),
          journalIds: z.array(z.uuid()).max(100).default([]),
          reviewerAffiliation: z.string().trim().min(2).max(300).optional(),
          reviewerExpertise: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
        })
        .strict()
        .parse(request.body);
      if (body.role === 'REVIEWER' && !body.reviewerAffiliation)
        return reply.code(422).send({
          code: 'REVIEWER_AFFILIATION_REQUIRED',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const [role, journalCount] = await Promise.all([
        database.role.findUnique({ where: { code: body.role } }),
        database.journal.count({ where: { id: { in: body.journalIds }, retiredAt: null } }),
      ]);
      if (!role || journalCount !== new Set(body.journalIds).size)
        return reply.code(422).send({
          code: 'MEMBERSHIP_INVALID',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const invitationToken = generateOpaqueToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
      const totpSecret = generateTotpSecret();
      const result = await database.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            email: body.email.toLowerCase(),
            displayName: body.displayName,
            status: 'INVITED',
            totpSecretCipher: encryptSecret(totpSecret, config.ENCRYPTION_KEY),
            roles: { create: { roleId: role.id, grantedBy: actor.id } },
            journalScopes: {
              create: [...new Set(body.journalIds)].map((journalId) => ({
                journalId,
                grantedBy: actor.id,
              })),
            },
            ...(body.role === 'REVIEWER'
              ? {
                  reviewerProfile: {
                    create: {
                      affiliation: body.reviewerAffiliation!,
                      expertise: body.reviewerExpertise ?? [],
                    },
                  },
                }
              : {}),
          },
          select: { id: true, email: true, displayName: true, status: true, createdAt: true },
        });
        await tx.staffInvitation.create({
          data: {
            employeeId: employee.id,
            tokenHash: hashOpaqueToken(invitationToken),
            createdById: actor.id,
            expiresAt,
          },
        });
        await appendAudit(tx, request, {
          action: 'employee.invited',
          entity: 'Employee',
          entityId: employee.id,
          after: { ...employee, role: body.role, journalIds: body.journalIds },
        });
        return employee;
      });
      return reply.code(201).send({ ...result, invitationToken, expiresAt });
    },
  );

  app.post(
    '/api/v1/admin/employees/:id/totp/reset',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: { tags: ['Users'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'user:manage');
      if (actor.role !== 'ADMIN')
        return reply.code(403).send({
          code: 'FORBIDDEN',
          messageKey: 'error.forbidden',
          correlationId: request.id,
        });
      const employeeId = z.uuid().parse((request.params as { id: string }).id);
      if (employeeId === actor.id)
        return reply.code(409).send({
          code: 'SELF_TOTP_RESET_USE_SETTINGS',
          messageKey: 'admin.security.use_self_service',
          correlationId: request.id,
        });
      const body = staffStepUpSchema.parse(request.body);
      if (!(await verifyStaffStepUpCredentials(actor.id, body.currentPassword, body.currentTotp))) {
        authDenied.inc({ reason: 'step_up' });
        return reply.code(403).send({
          code: 'STEP_UP_AUTH_FAILED',
          messageKey: 'admin.security.invalid_credentials',
          correlationId: request.id,
        });
      }
      return resetStaffTotp(request, employeeId, 'employee.totp.reset.admin');
    },
  );

  app.patch(
    '/api/v1/admin/employees/:id',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Users'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'user:manage');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const roleSchema = z.enum([
        'OPERATOR',
        'EDITOR',
        'REVIEWER',
        'CHIEF_EDITOR',
        'CONTENT_ADMIN',
        'ADMIN',
        'AUDITOR',
      ]);
      const body = z
        .object({
          status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']).optional(),
          roles: z.array(roleSchema).min(1).max(8).optional(),
          journalIds: z.array(z.uuid()).max(100).optional(),
        })
        .strict()
        .refine((value) => Object.values(value).some((entry) => entry !== undefined))
        .parse(request.body);
      if (body.roles || body.journalIds) requirePermission(actor, 'role:manage');
      if (id === actor.id && body.status && body.status !== 'ACTIVE')
        return reply.code(409).send({
          code: 'SELF_DISABLE_FORBIDDEN',
          messageKey: 'error.forbidden',
          correlationId: request.id,
        });
      const before = await database.employee.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          roles: { select: { role: { select: { code: true } } } },
          journalScopes: { select: { journalId: true } },
        },
      });
      if (!before)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const uniqueRoles = [...new Set(body.roles ?? [])];
      const uniqueJournals = [...new Set(body.journalIds ?? [])];
      const [selectedRoles, journalCount, reviewerProfile] = await Promise.all([
        body.roles
          ? database.role.findMany({ where: { code: { in: uniqueRoles } }, select: { id: true } })
          : Promise.resolve([]),
        body.journalIds
          ? database.journal.count({ where: { id: { in: uniqueJournals }, retiredAt: null } })
          : Promise.resolve(0),
        body.roles?.includes('REVIEWER')
          ? database.reviewerProfile.findUnique({ where: { employeeId: id }, select: { id: true } })
          : Promise.resolve(null),
      ]);
      if (
        (body.roles && selectedRoles.length !== uniqueRoles.length) ||
        (body.journalIds && journalCount !== uniqueJournals.length) ||
        (body.roles?.includes('REVIEWER') && !reviewerProfile)
      )
        return reply.code(422).send({
          code: 'MEMBERSHIP_INVALID',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const after = await database.$transaction(async (tx) => {
        if (body.roles) {
          await tx.employeeRole.deleteMany({ where: { employeeId: id } });
          await tx.employeeRole.createMany({
            data: selectedRoles.map((role) => ({
              employeeId: id,
              roleId: role.id,
              grantedBy: actor.id,
            })),
          });
          await tx.reviewerProfile.updateMany({
            where: { employeeId: id },
            data: { active: body.roles.includes('REVIEWER') },
          });
        }
        if (body.journalIds) {
          await tx.employeeJournalScope.deleteMany({ where: { employeeId: id } });
          await tx.employeeJournalScope.createMany({
            data: uniqueJournals.map((journalId) => ({
              employeeId: id,
              journalId,
              grantedBy: actor.id,
            })),
          });
        }
        if (body.status)
          await tx.employee.update({
            where: { id },
            data: {
              status: body.status,
              disabledAt: body.status === 'DISABLED' ? new Date() : null,
              ...(body.status !== 'ACTIVE'
                ? {
                    sessions: {
                      updateMany: { where: { revokedAt: null }, data: { revokedAt: new Date() } },
                    },
                  }
                : {}),
            },
          });
        const updated = await tx.employee.findUniqueOrThrow({
          where: { id },
          select: {
            id: true,
            email: true,
            displayName: true,
            status: true,
            roles: { select: { role: { select: { code: true } } } },
            journalScopes: { select: { journalId: true } },
          },
        });
        await appendAudit(tx, request, {
          action: 'employee.updated',
          entity: 'Employee',
          entityId: id,
          before,
          after: updated,
        });
        return updated;
      });
      return after;
    },
  );

  app.get(
    '/api/v1/admin/roles',
    { preHandler: authenticateStaff, schema: { tags: ['Users'], security: [{ staffCookie: [] }] } },
    async (request) => {
      requirePermission(request.actor!, 'role:manage');
      return {
        items: await database.role.findMany({
          include: { permissions: { include: { permission: true } } },
          orderBy: { code: 'asc' },
        }),
      };
    },
  );

  app.get(
    '/api/v1/admin/employees',
    { preHandler: authenticateStaff, schema: { tags: ['Users'], security: [{ staffCookie: [] }] } },
    async (request) => {
      requirePermission(request.actor!, 'user:manage');
      const items = await database.employee.findMany({
        include: {
          roles: { include: { role: true } },
          journalScopes: { include: { journal: { select: { code: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return {
        items: items.map(
          ({ passwordHash: _passwordHash, totpSecretCipher: _totpSecret, ...employee }) => employee,
        ),
      };
    },
  );

  app.get(
    '/api/v1/admin/reviewers',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Reviewers'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      requirePermission(request.actor!, 'review:assign');
      const items = await database.reviewerProfile.findMany({
        include: {
          employee: { select: { id: true, displayName: true, email: true, status: true } },
          _count: { select: { assignments: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.patch(
    '/api/v1/admin/reviewers/:id',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Reviewers'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      requirePermission(request.actor!, 'review:assign');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({
          affiliation: z.string().trim().min(1).max(300),
          expertise: z.array(z.string().trim().min(1).max(200)).max(50),
          active: z.boolean(),
        })
        .strict()
        .parse(request.body);
      const before = await database.reviewerProfile.findUnique({ where: { id } });
      if (!before)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const after = await database.$transaction(async (tx) => {
        const updated = await tx.reviewerProfile.update({
          where: { id },
          data: { affiliation: body.affiliation, expertise: body.expertise, active: body.active },
        });
        await appendAudit(tx, request, {
          action: 'reviewer.updated',
          entity: 'ReviewerProfile',
          entityId: id,
          before,
          after: updated,
        });
        return updated;
      });
      return after;
    },
  );

  app.get(
    '/api/v1/admin/translations',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Translations'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      requirePermission(request.actor!, 'translation:configure');
      return {
        items: await database.translationKey.findMany({
          include: { versions: { orderBy: [{ locale: 'asc' }, { version: 'desc' }] } },
          orderBy: { key: 'asc' },
          take: 500,
        }),
      };
    },
  );

  app.post(
    '/api/v1/admin/translations/:key/versions',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Translations'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      requirePermission(request.actor!, 'translation:configure');
      const key = z
        .string()
        .regex(/^[a-z][a-z0-9_.-]{2,199}$/)
        .parse((request.params as { key: string }).key);
      const body = z
        .object({
          namespace: z.string().trim().min(1).max(100),
          description: z.string().trim().min(1).max(2_000),
          locale: z.enum(['uz-Latn', 'ru', 'en']),
          message: z.string().min(1).max(20_000),
        })
        .strict()
        .parse(request.body);
      const created = await database.$transaction(async (tx) => {
        const translationKey = await tx.translationKey.upsert({
          where: { key },
          update: { namespace: body.namespace, description: body.description },
          create: { key, namespace: body.namespace, description: body.description },
        });
        const latest = await tx.translationVersion.findFirst({
          where: { translationKeyId: translationKey.id, locale: databaseLocale(body.locale) },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const version = await tx.translationVersion.create({
          data: {
            translationKeyId: translationKey.id,
            locale: databaseLocale(body.locale),
            version: (latest?.version ?? 0) + 1,
            message: body.message,
            placeholders: placeholders(body.message),
            createdById: request.actor!.id,
          },
        });
        await appendAudit(tx, request, {
          action: 'translation.version.created',
          entity: 'TranslationVersion',
          entityId: version.id,
          after: {
            key,
            locale: body.locale,
            version: version.version,
            placeholders: placeholders(body.message),
          },
        });
        return version;
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/api/v1/admin/translation-versions/:id/state',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Translations'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      requirePermission(request.actor!, 'translation:configure');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({ targetState: z.enum(['REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED']) })
        .strict()
        .parse(request.body);
      const before = await database.translationVersion.findUnique({ where: { id } });
      if (!before)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const allowed: Record<string, readonly string[]> = {
        DRAFT: ['REVIEW'],
        REVIEW: ['APPROVED'],
        APPROVED: ['PUBLISHED'],
        PUBLISHED: ['RETIRED'],
        RETIRED: [],
      };
      if (!allowed[before.state]?.includes(body.targetState))
        return reply.code(409).send({
          code: 'INVALID_TRANSITION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      if (
        ['APPROVED', 'PUBLISHED'].includes(body.targetState) &&
        before.createdById === request.actor!.id
      )
        return reply.code(409).send({
          code: 'FOUR_EYES_REQUIRED',
          messageKey: 'error.forbidden',
          correlationId: request.id,
        });
      const after = await database.$transaction(async (tx) => {
        if (body.targetState === 'PUBLISHED')
          await tx.translationVersion.updateMany({
            where: {
              translationKeyId: before.translationKeyId,
              locale: before.locale,
              state: 'PUBLISHED',
              id: { not: before.id },
            },
            data: { state: 'RETIRED' },
          });
        const updated = await tx.translationVersion.update({
          where: { id },
          data: {
            state: body.targetState,
            ...(body.targetState === 'APPROVED' ? { approvedById: request.actor!.id } : {}),
            ...(body.targetState === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
          },
        });
        await appendAudit(tx, request, {
          action: 'translation.version.state_changed',
          entity: 'TranslationVersion',
          entityId: id,
          before: { state: before.state },
          after: { state: updated.state },
        });
        return updated;
      });
      return after;
    },
  );

  app.get(
    '/api/v1/admin/privacy/requests',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Privacy'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      const actor = request.actor!;
      requirePermission(actor, 'privacy:case:read');
      const query = z
        .object({
          status: z
            .enum([
              'RECEIVED',
              'IDENTITY_VERIFICATION',
              'IN_REVIEW',
              'APPROVED',
              'DENIED',
              'EXECUTING',
              'COMPLETED',
              'CANCELLED',
            ])
            .optional(),
          type: z.enum(['ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION']).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);
      const canManage = hasPermission(actor.role, 'privacy:case:manage');
      const items = await database.dataSubjectRequest.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.type ? { type: query.type } : {}),
        },
        include: {
          user: { include: { authorProfile: true } },
          assignedTo: { select: { id: true, displayName: true } },
          relatedLegalHolds: { where: { status: 'ACTIVE' }, select: { id: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: query.limit,
      });
      return {
        items: items.map((item) => ({
          id: item.id,
          publicId: item.publicId,
          type: item.type,
          status: item.status,
          locale: publicLocale(item.locale),
          dueAt: item.dueAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          rowVersion: item.rowVersion,
          identityVerifiedAt: item.identityVerifiedAt,
          decisionReason: item.decisionReason,
          completedAt: item.completedAt,
          assignedTo: item.assignedTo,
          activeLegalHoldCount: item.relatedLegalHolds.length,
          subject: item.user.authorProfile
            ? {
                id: item.user.id,
                displayName: `${item.user.authorProfile.lastName} ${item.user.authorProfile.firstName}`,
                email: maskEmail(
                  decryptSecret(item.user.authorProfile.emailCipher, config.ENCRYPTION_KEY),
                ),
                phone: maskPhone(
                  decryptSecret(item.user.authorProfile.phoneCipher, config.ENCRYPTION_KEY),
                ),
              }
            : null,
          ...(canManage ? { requestNote: item.requestNote } : {}),
        })),
      };
    },
  );

  app.patch(
    '/api/v1/admin/privacy/requests/:id',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Privacy'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'privacy:case:manage');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({
          expectedRowVersion: z.number().int().nonnegative(),
          targetStatus: z.enum([
            'RECEIVED',
            'IDENTITY_VERIFICATION',
            'IN_REVIEW',
            'APPROVED',
            'DENIED',
            'EXECUTING',
            'COMPLETED',
            'CANCELLED',
          ]),
          assignedToId: z.uuid().nullable().optional(),
          decisionReason: z.string().trim().min(10).max(4_000).optional(),
          executionReport: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
        .parse(request.body);
      const item = await database.dataSubjectRequest.findUnique({ where: { id } });
      if (!item)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (
        item.rowVersion !== body.expectedRowVersion ||
        !canTransitionPrivacyRequest(item.status, body.targetStatus)
      )
        return reply.code(409).send({
          code: 'INVALID_TRANSITION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      if (
        ['APPROVED', 'DENIED', 'EXECUTING', 'COMPLETED'].includes(body.targetStatus) &&
        !actor.stepUpVerified
      )
        throw new TransitionDeniedError('STEP_UP_REQUIRED');
      if (['APPROVED', 'DENIED'].includes(body.targetStatus) && !body.decisionReason)
        throw new BusinessRuleError('DECISION_REASON_REQUIRED', 'validation.required', 422);
      if (body.targetStatus === 'COMPLETED' && !body.executionReport)
        throw new BusinessRuleError('EXECUTION_REPORT_REQUIRED', 'validation.required', 422);
      if (
        item.type === 'ERASURE' &&
        ['EXECUTING', 'COMPLETED'].includes(body.targetStatus) &&
        !config.RETENTION_ENABLED
      )
        throw new BusinessRuleError('RETENTION_POLICY_NOT_APPROVED', 'privacy.policy_not_approved');
      const activeLegalHolds = ['EXECUTING', 'COMPLETED'].includes(body.targetStatus)
        ? await database.legalHold.count({
            where: {
              status: 'ACTIVE',
              OR: [
                { subjectUserId: item.userId },
                { dataSubjectRequestId: item.id },
                { submission: { ownerId: item.userId } },
              ],
            },
          })
        : 0;
      if (activeLegalHolds > 0)
        throw new BusinessRuleError('LEGAL_HOLD_ACTIVE', 'privacy.legal_hold_active');
      if (body.assignedToId) {
        const assignee = await database.employee.findFirst({
          where: { id: body.assignedToId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!assignee) throw new BusinessRuleError('ASSIGNEE_INVALID', 'validation.required', 422);
      }
      const updated = await serializableTransactionWithRetry(
        database,
        async (tx) => {
          const changed = await tx.dataSubjectRequest.updateMany({
            where: { id: item.id, rowVersion: body.expectedRowVersion, status: item.status },
            data: {
              status: body.targetStatus,
              ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId } : {}),
              ...(body.decisionReason ? { decisionReason: body.decisionReason } : {}),
              ...(body.executionReport
                ? {
                    executionReport: JSON.parse(
                      JSON.stringify(body.executionReport),
                    ) as Prisma.InputJsonValue,
                  }
                : {}),
              ...(body.targetStatus === 'IN_REVIEW' ? { identityVerifiedAt: new Date() } : {}),
              ...(body.targetStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
              rowVersion: { increment: 1 },
            },
          });
          if (changed.count !== 1) return null;
          const after = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: item.id } });
          await tx.notification.create({
            data: {
              eventId: randomUUID(),
              userId: item.userId,
              eventCode: `privacy.request.${body.targetStatus.toLowerCase()}`,
              locale: item.locale,
              templateVersion: 'static-v1',
              templateSnapshot: {
                key: `privacy.notification.${body.targetStatus.toLowerCase()}`,
              },
              variables: { public_id: item.publicId },
            },
          });
          await appendAudit(tx, request, {
            action: 'privacy.request.status_changed',
            entity: 'DataSubjectRequest',
            entityId: item.id,
            before: { status: item.status, rowVersion: item.rowVersion },
            after: {
              status: after.status,
              rowVersion: after.rowVersion,
              decisionReasonRecorded: Boolean(body.decisionReason),
              executionReportRecorded: Boolean(body.executionReport),
            },
          });
          return after;
        },
        { lockAuditChain: true },
      );
      if (!updated)
        return reply.code(409).send({
          code: 'STALE_ACTION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      return updated;
    },
  );

  app.get(
    '/api/v1/admin/privacy/legal-holds',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Privacy'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      requirePermission(request.actor!, 'privacy:case:read');
      return {
        items: await database.legalHold.findMany({
          include: {
            placedBy: { select: { id: true, displayName: true } },
            releasedBy: { select: { id: true, displayName: true } },
            submission: { select: { id: true, publicId: true } },
            dataSubjectRequest: { select: { id: true, publicId: true } },
          },
          orderBy: { placedAt: 'desc' },
          take: 100,
        }),
      };
    },
  );

  app.post(
    '/api/v1/admin/privacy/legal-holds',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Privacy'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'retention:hold:manage');
      if (!actor.stepUpVerified) throw new TransitionDeniedError('STEP_UP_REQUIRED');
      const body = z
        .object({
          subjectUserId: z.uuid().optional(),
          submissionId: z.uuid().optional(),
          dataSubjectRequestId: z.uuid().optional(),
          reason: z.string().trim().min(10).max(4_000),
          expiresAt: z.coerce.date().optional(),
        })
        .strict()
        .refine((value) => Boolean(value.subjectUserId || value.submissionId), {
          message: 'subjectUserId or submissionId is required',
        })
        .parse(request.body);
      if (body.expiresAt && body.expiresAt <= new Date())
        throw new BusinessRuleError('LEGAL_HOLD_EXPIRY_INVALID', 'validation.required', 422);
      const [submission, privacyCase] = await Promise.all([
        body.submissionId
          ? database.submission.findUnique({ where: { id: body.submissionId } })
          : null,
        body.dataSubjectRequestId
          ? database.dataSubjectRequest.findUnique({ where: { id: body.dataSubjectRequestId } })
          : null,
      ]);
      if (body.submissionId && !submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (body.dataSubjectRequestId && !privacyCase)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const subjectUserId = body.subjectUserId ?? submission?.ownerId;
      if (
        (submission && subjectUserId && submission.ownerId !== subjectUserId) ||
        (privacyCase && subjectUserId && privacyCase.userId !== subjectUserId)
      )
        throw new BusinessRuleError('LEGAL_HOLD_SUBJECT_MISMATCH', 'validation.required', 422);
      const existing = await database.legalHold.findFirst({
        where: {
          status: 'ACTIVE',
          OR: [
            ...(body.submissionId ? [{ submissionId: body.submissionId }] : []),
            ...(!body.submissionId && subjectUserId ? [{ subjectUserId }] : []),
          ],
        },
      });
      if (existing)
        return reply.code(409).send({
          code: 'LEGAL_HOLD_ALREADY_ACTIVE',
          messageKey: 'privacy.legal_hold_active',
          correlationId: request.id,
        });
      const created = await database.$transaction(async (tx) => {
        const hold = await tx.legalHold.create({
          data: {
            subjectUserId: subjectUserId ?? null,
            submissionId: body.submissionId ?? null,
            dataSubjectRequestId: body.dataSubjectRequestId ?? null,
            reason: body.reason,
            expiresAt: body.expiresAt ?? null,
            placedById: actor.id,
          },
        });
        await appendAudit(tx, request, {
          action: 'legal_hold.placed',
          entity: 'LegalHold',
          entityId: hold.id,
          ...(submission?.journalId ? { journalId: submission.journalId } : {}),
          after: {
            subjectUserId: subjectUserId ?? null,
            submissionId: body.submissionId ?? null,
            dataSubjectRequestId: body.dataSubjectRequestId ?? null,
            expiresAt: body.expiresAt ?? null,
            reasonRecorded: true,
          },
        });
        return hold;
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/api/v1/admin/privacy/legal-holds/:id/release',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Privacy'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'retention:hold:manage');
      if (!actor.stepUpVerified) throw new TransitionDeniedError('STEP_UP_REQUIRED');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const body = z
        .object({ releaseReason: z.string().trim().min(10).max(4_000) })
        .strict()
        .parse(request.body);
      const before = await database.legalHold.findUnique({
        where: { id },
        include: { submission: true },
      });
      if (!before)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (before.status !== 'ACTIVE')
        return reply.code(409).send({
          code: 'LEGAL_HOLD_NOT_ACTIVE',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      const released = await database.$transaction(async (tx) => {
        const changed = await tx.legalHold.updateMany({
          where: { id, status: 'ACTIVE' },
          data: {
            status: 'RELEASED',
            releasedById: actor.id,
            releasedAt: new Date(),
            releaseReason: body.releaseReason,
          },
        });
        if (changed.count !== 1) return null;
        const hold = await tx.legalHold.findUniqueOrThrow({ where: { id } });
        await appendAudit(tx, request, {
          action: 'legal_hold.released',
          entity: 'LegalHold',
          entityId: id,
          ...(before.submission?.journalId ? { journalId: before.submission.journalId } : {}),
          before: { status: before.status },
          after: { status: hold.status, releaseReasonRecorded: true },
        });
        return hold;
      });
      if (!released)
        return reply.code(409).send({
          code: 'STALE_ACTION',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      return released;
    },
  );

  app.get(
    '/api/v1/admin/audit',
    { preHandler: authenticateStaff, schema: { tags: ['Audit'], security: [{ staffCookie: [] }] } },
    async (request) => {
      const actor = request.actor!;
      if (
        !hasPermission(actor.role, 'audit:read:all') &&
        !hasPermission(actor.role, 'audit:read:journal')
      )
        throw new TransitionDeniedError('FORBIDDEN');
      const query = z
        .object({
          cursor: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          action: z.string().max(150).optional(),
        })
        .parse(request.query);
      const rows = await database.auditLog.findMany({
        where: {
          ...(query.action ? { action: query.action } : {}),
          ...(!hasPermission(actor.role, 'audit:read:all')
            ? { journalId: { in: [...actor.journalIds] } }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    },
  );

  app.get(
    '/api/v1/admin/reports/overview',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Reports'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      requirePermission(request.actor!, 'export:create');
      const actor = request.actor!;
      const byStatus = await database.submission.groupBy({
        by: ['status'],
        where: { journalId: { in: [...actor.journalIds] }, deletedAt: null },
        _count: { _all: true },
      });
      const byJournal = await database.submission.groupBy({
        by: ['journalId'],
        where: { journalId: { in: [...actor.journalIds] }, deletedAt: null },
        _count: { _all: true },
      });
      return { generatedAt: new Date().toISOString(), byStatus, byJournal };
    },
  );

  app.get(
    '/api/v1/admin/notifications',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Notifications'], security: [{ staffCookie: [] }] },
    },
    async (request) => {
      const actor = request.actor!;
      if (
        !hasPermission(actor.role, 'operations:read') &&
        !hasPermission(actor.role, 'notification:replay')
      )
        throw new TransitionDeniedError('FORBIDDEN');
      const query = z
        .object({
          status: z
            .enum([
              'PENDING',
              'PROCESSING',
              'SENT',
              'RETRYING',
              'FAILED',
              'DEAD_LETTER',
              'CANCELLED',
            ])
            .optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);
      return {
        items: await database.notification.findMany({
          where: {
            ...(query.status ? { status: query.status } : {}),
            ...(actor.role === 'ADMIN' || actor.role === 'AUDITOR'
              ? {}
              : { submission: { journalId: { in: [...actor.journalIds] } } }),
          },
          select: {
            id: true,
            eventId: true,
            eventCode: true,
            status: true,
            attempts: true,
            generation: true,
            lastErrorCode: true,
            createdAt: true,
            sentAt: true,
            submission: { select: { publicId: true, journalId: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: query.limit,
        }),
      };
    },
  );

  app.get(
    '/api/v1/admin/reports/submissions.csv',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Reports'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'export:create');
      const rows = await database.submission.findMany({
        where: {
          ...(actor.role === 'AUDITOR' || actor.role === 'ADMIN'
            ? {}
            : { journalId: { in: [...actor.journalIds] } }),
          deletedAt: null,
        },
        select: {
          publicId: true,
          status: true,
          currentVersionNo: true,
          submittedAt: true,
          acceptedAt: true,
          publishedAt: true,
          journal: { select: { code: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 50_000,
      });
      const csvCell = (value: string | number | Date | null): string => {
        const raw =
          value instanceof Date ? value.toISOString() : value === null ? '' : String(value);
        const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
        return `"${protectedValue.replaceAll('"', '""')}"`;
      };
      const header = [
        'submission_id',
        'journal',
        'status',
        'version',
        'submitted_at',
        'accepted_at',
        'published_at',
      ];
      const csv = [
        header.map(csvCell).join(','),
        ...rows.map((row) =>
          [
            row.publicId,
            row.journal.code,
            row.status,
            row.currentVersionNo,
            row.submittedAt,
            row.acceptedAt,
            row.publishedAt,
          ]
            .map(csvCell)
            .join(','),
        ),
      ].join('\r\n');
      await database.$transaction(async (tx) =>
        appendAudit(tx, request, {
          action: 'report.submissions.exported',
          entity: 'Report',
          after: { format: 'csv', rowCount: rows.length },
        }),
      );
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header(
        'content-disposition',
        `attachment; filename="hmqa-submissions-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return `\uFEFF${csv}`;
    },
  );

  app.post(
    '/api/v1/admin/notifications/:id/replay',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Notifications'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const actor = request.actor!;
      requirePermission(actor, 'notification:replay');
      const id = z.uuid().parse((request.params as { id: string }).id);
      const notification = await database.notification.findUnique({
        where: { id },
        include: { submission: true },
      });
      if (!notification)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      if (notification.submission && !hasJournalScope(actor, notification.submission.journalId))
        throw new TransitionDeniedError('OUT_OF_SCOPE');
      if (!['FAILED', 'DEAD_LETTER'].includes(notification.status))
        return reply.code(409).send({
          code: 'NOTIFICATION_NOT_REPLAYABLE',
          messageKey: 'error.stale_action',
          correlationId: request.id,
        });
      const updated = await database.$transaction(async (tx) => {
        const mutation = await tx.notification.updateMany({
          where: { id, status: { in: ['FAILED', 'DEAD_LETTER'] } },
          data: {
            status: 'RETRYING',
            generation: { increment: 1 },
            nextAttemptAt: new Date(),
            lastErrorCode: null,
          },
        });
        if (mutation.count !== 1) throw new Error('CONCURRENT_UPDATE');
        const after = await tx.notification.findUniqueOrThrow({ where: { id } });
        await appendAudit(tx, request, {
          action: 'notification.replayed',
          entity: 'Notification',
          entityId: id,
          ...(notification.submission ? { journalId: notification.submission.journalId } : {}),
          before: { status: notification.status, generation: notification.generation },
          after: { status: after.status, generation: after.generation },
        });
        return after;
      });
      return updated;
    },
  );

  app.get(
    '/api/v1/admin/settings/runtime',
    {
      preHandler: authenticateStaff,
      schema: { tags: ['Settings'], security: [{ staffCookie: [] }] },
    },
    (request) => {
      requirePermission(request.actor!, 'operations:read');
      return {
        timezone: config.APP_TIMEZONE,
        defaultLocale: config.DEFAULT_LOCALE,
        supportedLocales: config.SUPPORTED_LOCALES.split(','),
        fileMaxBytes: config.FILE_MAX_BYTES,
        signedUrlTtlSeconds: config.SIGNED_URL_TTL_SECONDS,
        retentionEnabled: config.RETENTION_ENABLED,
        retentionDraftDays: config.RETENTION_DRAFT_DAYS,
        localAuthenticationEnabledInProduction: config.LOCAL_AUTH_PRODUCTION_ENABLED,
      };
    },
  );

  app.post(
    '/api/v1/admin/submissions/:id/transitions',
    {
      preHandler: [authenticateStaff, verifyCsrf],
      schema: { tags: ['Workflow'], security: [{ staffCookie: [] }] },
    },
    async (request, reply) => {
      const parsed = transitionRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(422).send({
          code: 'VALIDATION_ERROR',
          messageKey: 'validation.required',
          correlationId: request.id,
        });
      const id = z.uuid().parse((request.params as { id: string }).id);
      const submission = await database.submission.findUnique({
        where: { id },
        include: {
          journal: true,
          requirementVersion: true,
          owner: { include: { consents: { where: { granted: true, revokedAt: null }, take: 1 } } },
          versions: {
            orderBy: { versionNo: 'desc' },
            take: 1,
            include: {
              authors: { select: { id: true } },
              metadata: { select: { id: true } },
              files: { include: { file: { select: { scanStatus: true, storageStatus: true } } } },
              preflightRuns: { orderBy: { createdAt: 'desc' } },
            },
          },
          assignments: { where: { status: { in: ['PENDING', 'ACCEPTED'] } } },
          reviewAssignments: {
            where: { status: 'ACCEPTED', conflictDeclared: false },
            include: { review: { select: { id: true } } },
          },
        },
      });
      if (!submission)
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', messageKey: 'error.system', correlationId: request.id });
      const latestVersion = submission.versions[0];
      const requirementConfig = journalRequirementConfigSchema.safeParse(
        submission.requirementVersion.config,
      );
      if (!requirementConfig.success)
        throw new BusinessRuleError(
          'REQUIREMENT_CONFIG_INVALID',
          'error.preflight_incomplete',
          409,
        );
      const reviewPolicy = requirementConfig.data.workflow;
      const requiredReviewerCount = reviewPolicy.requiredReviewerCount;
      const requiredFileRuns = latestVersion?.files
        .filter((file) => file.required)
        .map((file) => latestVersion.preflightRuns.find((run) => run.fileId === file.fileId));
      const guardContext = {
        journalId: submission.journalId,
        ownerId: submission.ownerId,
        activeConsent: submission.owner.consents.length > 0,
        requiredFieldsComplete: Boolean(
          latestVersion?.metadata && latestVersion.authors.length > 0,
        ),
        mandatoryFilesClean: Boolean(
          latestVersion?.files.some((file) => file.required) &&
          latestVersion.files
            .filter((file) => file.required)
            .every(
              (file) => file.file.scanStatus === 'CLEAN' && file.file.storageStatus === 'STORED',
            ),
        ),
        blockingPreflightCount:
          requiredFileRuns?.reduce((total, run) => total + (run?.blockingCount ?? 1), 0) ?? 1,
        technicalReviewComplete: Boolean(
          requiredFileRuns &&
          requiredFileRuns.length > 0 &&
          requiredFileRuns.every((run) => run?.status === 'COMPLETED' && run.blockingCount === 0),
        ),
        assignedEditor: submission.assignments.some((assignment) => assignment.kind === 'EDITOR'),
        requiredReviewersAssigned:
          requiredReviewerCount > 0 && submission.reviewAssignments.length >= requiredReviewerCount,
        anonymizedPackageReady:
          requiredReviewerCount > 0 &&
          submission.reviewAssignments
            .slice(0, requiredReviewerCount)
            .every((assignment) => assignment.anonymizedFileId.length > 0),
        decisionRequiresCompletedReviews: reviewPolicy.decisionRequiresCompletedReviews,
        requiredReviewsComplete:
          submission.reviewAssignments.filter((assignment) => assignment.review).length >=
          requiredReviewerCount,
        fourEyesRequired: submission.journal.fourEyesRequired,
        ...(parsed.data.publicReason ? { publicReason: parsed.data.publicReason } : {}),
        ...(parsed.data.deadline ? { deadline: new Date(parsed.data.deadline) } : {}),
        ...(parsed.data.internalReason ? { decisionBasis: parsed.data.internalReason } : {}),
        ...(parsed.data.publicationReference
          ? { publicationReference: parsed.data.publicationReference }
          : {}),
      };
      const result = await transitionSubmission(database, {
        submissionId: id,
        expectedRowVersion: parsed.data.expectedRowVersion,
        targetStatus: parsed.data.targetStatus,
        ...(parsed.data.decisionProposalId
          ? { decisionProposalId: parsed.data.decisionProposalId }
          : {}),
        actor: request.actor!,
        context: guardContext,
        ...(parsed.data.publicReason ? { publicReason: parsed.data.publicReason } : {}),
        ...(parsed.data.internalReason ? { internalReason: parsed.data.internalReason } : {}),
        correlationId: request.id,
        requestId: request.id,
        ipHash: hashOpaqueToken(request.ip),
        userAgentHash: hashOpaqueToken(request.headers['user-agent'] ?? ''),
        notification: {
          eventCode: `submission.${parsed.data.targetStatus.toLowerCase()}`,
          locale: publicLocale(submission.owner.locale ?? 'uz_Latn'),
          templateVersion: 'static-v1',
          templateSnapshot: { key: `status.${parsed.data.targetStatus.toLowerCase()}` },
          variables: { public_id: submission.publicId },
        },
      });
      return reply.code(200).send(result);
    },
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, correlationId: request.id }, 'request failed');
    if (error instanceof TransitionDeniedError) {
      authDenied.inc({ reason: error.code.toLowerCase() });
      const status =
        error.code === 'INVALID_TRANSITION' || error.code === 'GUARD_FAILED' ? 409 : 403;
      return reply.code(status).send({
        code: error.code,
        messageKey: 'error.forbidden',
        correlationId: request.id,
        details: error.details,
      });
    }
    if (error instanceof BusinessRuleError)
      return reply.code(error.statusCode).send({
        code: error.code,
        messageKey: error.messageKey,
        correlationId: request.id,
      });
    if (error instanceof app.multipartErrors.RequestFileTooLargeError)
      return reply.code(413).send({
        code: 'FILE_TOO_LARGE',
        messageKey: 'error.file_size',
        correlationId: request.id,
      });
    if (error instanceof z.ZodError)
      return reply.code(422).send({
        code: 'VALIDATION_ERROR',
        messageKey: 'validation.required',
        correlationId: request.id,
      });
    Sentry.captureException(error, {
      tags: {
        service: 'api',
        correlationId: request.id,
        route: request.routeOptions.url ?? 'unknown',
      },
    });
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      messageKey: 'error.system',
      message: translate(request.actorLocale, 'error.system', { correlation_id: request.id }),
      correlationId: request.id,
    });
  });

  return app;
}
