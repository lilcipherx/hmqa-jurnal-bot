import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Code generation and static validation do not connect to this fallback URL.
  // Runtime services still fail closed through @hmqa/config when DATABASE_URL is absent.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://hmqa:hmqa@localhost:5432/hmqa' },
});
