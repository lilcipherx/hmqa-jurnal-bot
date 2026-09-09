import { createHash } from 'node:crypto';
import { encryptSecret, hashPassword } from '@hmqa/security';
import { seedSystemAccess } from '../src/access-bootstrap.js';
import { createPrismaClient } from '../src/client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (process.env.NODE_ENV === 'production')
  throw new Error('Development seed is disabled in production');

const database = createPrismaClient(databaseUrl);

const journalSeed = [
  ['AXB', 'O‘zbekiston Respublikasi Huquqni muhofaza qilish akademiyasi Axborotnomasi'],
  ['TER', 'O‘zbekiston tergovchisi'],
  ['CCJ', 'Kriminologiya va jinoiy odil sudlov'],
  ['DIG', 'Raqamli kriminalistika'],
] as const;

async function seedAccess() {
  await seedSystemAccess(database);
}

async function seedJournals() {
  for (const [code, name] of journalSeed) {
    const journal = await database.journal.upsert({
      where: { code },
      update: {},
      create: { code, mode: 'CLOSED', active: true, fourEyesRequired: true },
    });
    for (const [locale, suffix] of [
      ['uz_Latn', ''],
      ['ru', ''],
      ['en', ''],
    ] as const) {
      await database.journalLocalization.upsert({
        where: { journalId_locale: { journalId: journal.id, locale } },
        update: {},
        create: {
          journalId: journal.id,
          locale,
          name: `${name}${suffix}`,
          shortName: code,
          description:
            'Synthetic development catalog record. Submission remains closed until approval.',
        },
      });
    }
    if (code === 'AXB') {
      const config = {
        manuscriptPackaging: 'UNAPPROVED',
        pageCountAuthority: 'UNAPPROVED',
        requiredFiles: [
          {
            category: 'MANUSCRIPT',
            labels: {
              'uz-Latn': 'Asosiy maqola',
              ru: 'Основная статья',
              en: 'Main manuscript',
            },
            formats: ['docx'],
            required: true,
            preflightRequired: true,
          },
        ],
        limits: {
          maxBytes: 19 * 1024 * 1024,
          maxFiles: 10,
          maxTotalBytes: 50 * 1024 * 1024,
        },
        metadata: {
          abstractMinWords: 150,
          abstractMaxWords: 300,
          keywordMinCount: 5,
          keywordMaxCount: 10,
          coauthorMaxCount: 10,
        },
        preflight: {
          docx: {
            rulesVersion: 'axborotnomasi-draft-2026-1',
            renderedPages: { min: 8, max: 10, severity: 'WARNING' },
            page: {
              widthMm: 210,
              heightMm: 297,
              toleranceMm: 1,
              severity: 'ERROR',
            },
            margins: {
              leftMm: 30,
              rightMm: 15,
              topMm: 20,
              bottomMm: 20,
              toleranceMm: 1,
              severity: 'ERROR',
            },
            defaultFont: {
              family: 'Times New Roman',
              sizePt: 14,
              tolerancePt: 0.5,
              severity: 'WARNING',
            },
            lineSpacing: { multiple: 1.5, tolerance: 0.05, severity: 'WARNING' },
            requiredMarkers: [],
          },
        },
        workflow: {
          reviewModel: 'NO_EXTERNAL_REVIEW',
          requiredReviewerCount: 0,
          decisionRequiresCompletedReviews: false,
        },
      };
      const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
      await database.journalRequirementVersion.upsert({
        where: { journalId_version: { journalId: journal.id, version: 1 } },
        update: {},
        create: {
          journalId: journal.id,
          version: 1,
          state: 'DRAFT',
          config,
          configHash,
          changeNote: 'Synthetic PRD-derived draft; requires Academy approval before publication.',
          localizations: {
            create: [
              {
                locale: 'uz_Latn',
                title: 'Axborotnomasi talablari',
                summary: 'Tasdiqlanmagan qoralama',
                body: 'DRAFT',
              },
              {
                locale: 'ru',
                title: 'Требования Axborotnomasi',
                summary: 'Неутверждённый черновик',
                body: 'DRAFT',
              },
              {
                locale: 'en',
                title: 'Axborotnomasi requirements',
                summary: 'Unapproved draft',
                body: 'DRAFT',
              },
            ],
          },
        },
      });
    }
  }
}

async function seedPeople() {
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Local-development-only-2026!';
  const totpSecret = process.env.SEED_STAFF_TOTP_SECRET;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!totpSecret || !/^[A-Z2-7]{32,}$/i.test(totpSecret) || /replace/i.test(totpSecret)) {
    throw new Error('SEED_STAFF_TOTP_SECRET must be a non-placeholder Base32 secret');
  }
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY is required for the development seed');
  const passwordHash = await hashPassword(password);
  const employees = [
    [process.env.SEED_ADMIN_EMAIL ?? 'admin@example.invalid', 'Synthetic Admin'],
    ['admin-2@example.invalid', 'Synthetic Second Admin'],
  ] as const;
  for (const [email, displayName] of employees) {
    const employee = await database.employee.upsert({
      where: { email },
      update: {
        passwordHash,
        totpSecretCipher: encryptSecret(totpSecret, encryptionKey),
        totpEnabled: true,
        totpResetRequiredAt: null,
      },
      create: {
        email,
        displayName,
        passwordHash,
        status: 'ACTIVE',
        totpSecretCipher: encryptSecret(totpSecret, encryptionKey),
        totpEnabled: true,
      },
    });
    const role = await database.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await database.employeeRole.upsert({
      where: { employeeId_roleId: { employeeId: employee.id, roleId: role.id } },
      update: {},
      create: { employeeId: employee.id, roleId: role.id },
    });
  }

  const author = await database.user.upsert({
    where: { telegramUserId: 9_000_000_001n },
    update: {},
    create: { telegramUserId: 9_000_000_001n, locale: 'uz_Latn' },
  });
  await database.authorProfile.upsert({
    where: { userId: author.id },
    update: {},
    create: {
      userId: author.id,
      fullName: 'Test Author',
      firstName: 'Test',
      lastName: 'Author',
      phoneCipher: encryptSecret('+999000000000', encryptionKey),
      phoneHash: createHash('sha256').update('+999000000000').digest('hex'),
      emailCipher: encryptSecret('author@example.invalid', encryptionKey),
      emailHash: createHash('sha256').update('author@example.invalid').digest('hex'),
      organization: 'Example Academy',
      position: 'Researcher',
      degreeCode: 'NONE',
      titleCode: 'NONE',
    },
  });
}

async function main() {
  await seedAccess();
  await seedJournals();
  await seedPeople();
}

main()
  .then(() => database.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Seed failed');
    await database.$disconnect();
    process.exit(1);
  });
