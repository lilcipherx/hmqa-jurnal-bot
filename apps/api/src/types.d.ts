import type { Locale } from '@hmqa/i18n';
import type { ScopedActor } from '@hmqa/domain';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ScopedActor | null;
    actorLocale: Locale;
    sessionId: string | null;
  }
}
