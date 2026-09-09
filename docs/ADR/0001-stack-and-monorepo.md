# ADR 0001 TypeScript monorepo and runtime stack

Status: Accepted

Use pnpm workspaces with Node 24 LTS-compatible TypeScript. Deploy Fastify API, grammY webhook bot, Next.js admin, BullMQ workers, PostgreSQL through Prisma 7, Redis, private S3-compatible storage, ClamAV, and a resource-limited LibreOffice subprocess inside the isolated file-worker container.

Fastify keeps the API surface explicit and schema-first while meeting the PRD's NestJS/Fastify preference. Prisma 7 is selected instead of the currently pre-release Prisma 8 line. Heavy document work stays outside request handlers; bounded OOXML parsing runs in the worker and rendering is delegated to the sandboxed headless office process.
