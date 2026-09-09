export const anonymizationIdentifierFields = [
  'firstName',
  'lastName',
  'middleName',
  'fullName',
  'organization',
  'orcid',
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');
}

/** Returns only field classes, never manuscript text or the matched identifier. */
export function findAnonymizedIdentifierTypes(
  sourceText: string,
  authorSnapshots: readonly unknown[],
): string[] {
  const haystack = normalized(sourceText);
  const matches = new Set<string>();
  for (const snapshot of authorSnapshots) {
    const data = record(snapshot);
    if (!data) continue;
    for (const field of anonymizationIdentifierFields) {
      const value = data[field];
      if (typeof value !== 'string') continue;
      const identifier = normalized(value);
      if (identifier.length >= 4 && haystack.includes(identifier)) matches.add(field);
    }
  }
  return [...matches].sort();
}
