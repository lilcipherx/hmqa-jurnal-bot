import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  encryptSecret,
  generateOpaqueToken,
  generateTotpSecret,
  hashOpaqueToken,
} from '@hmqa/security';
import { seedSystemAccess } from '../src/access-bootstrap.js';
import { createPrismaClient } from '../src/client.js';

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.ENCRYPTION_KEY;
const adminBaseUrl = process.env.ADMIN_BASE_URL;
if (!['staging', 'production'].includes(process.env.NODE_ENV ?? ''))
  throw new Error('Admin bootstrap is restricted to staging/production');
if (!databaseUrl || !encryptionKey || !adminBaseUrl)
  throw new Error('DATABASE_URL, ENCRYPTION_KEY and ADMIN_BASE_URL are required');
if (!stdin.isTTY || !stdout.isTTY) throw new Error('Admin bootstrap requires an interactive TTY');

const terminal = createInterface({ input: stdin, output: stdout });
const email = (await terminal.question('Initial admin email: ')).trim().toLowerCase();
const displayName = (await terminal.question('Initial admin display name: ')).trim();
terminal.close();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('.invalid'))
  throw new Error('A non-placeholder admin email is required');
if (displayName.length < 2 || displayName.length > 200)
  throw new Error('Admin display name must contain 2-200 characters');

const database = createPrismaClient(databaseUrl);
try {
  await seedSystemAccess(database);
  const adminRole = await database.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const invitationToken = generateOpaqueToken();
  const totpSecret = generateTotpSecret();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
  const requestId = randomUUID();
  const employee = await database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242424242)`;
    const existing = await tx.employeeRole.findFirst({
      where: { roleId: adminRole.id },
      select: { employeeId: true },
    });
    if (existing) throw new Error('An initial administrator already exists');

    const created = await tx.employee.create({
      data: {
        email,
        displayName,
        status: 'INVITED',
        totpSecretCipher: encryptSecret(totpSecret, encryptionKey),
      },
    });
    await tx.employeeRole.create({
      data: { employeeId: created.id, roleId: adminRole.id },
    });
    await tx.staffInvitation.create({
      data: {
        employeeId: created.id,
        tokenHash: hashOpaqueToken(invitationToken),
        createdById: created.id,
        expiresAt,
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
        action: 'employee.bootstrap.invited',
        entity: 'Employee',
        entityId: created.id,
        actorType: 'SYSTEM',
        requestId,
        before: null,
        after: { status: 'INVITED', role: 'ADMIN' },
      }),
    );
    await tx.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        actorRole: 'SYSTEM',
        action: 'employee.bootstrap.invited',
        entity: 'Employee',
        entityId: created.id,
        after: { status: 'INVITED', role: 'ADMIN' },
        outcome: 'SUCCESS',
        requestId,
        correlationId: requestId,
        prevHash: previous?.eventHash ?? null,
        eventHash,
      },
    });
    return created;
  });

  const invitationUrl = new URL('/invite', adminBaseUrl);
  invitationUrl.searchParams.set('token', invitationToken);
  stdout.write(`Initial administrator invitation created for ${employee.email}.\n`);
  stdout.write(`Expires at ${expiresAt.toISOString()}.\n`);
  stdout.write('Treat the following one-time URL as a secret; it is not written to logs or Git.\n');
  stdout.write(`${invitationUrl.toString()}\n`);
} finally {
  await database.$disconnect();
}
