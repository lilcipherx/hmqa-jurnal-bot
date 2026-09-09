import { describe, expect, it } from 'vitest';
import { findAnonymizedIdentifierTypes } from './anonymization-preflight.js';

describe('anonymous reviewer package checks', () => {
  it('reports identifier classes without leaking their values', () => {
    const result = findAnonymizedIdentifierTypes(
      'Prepared by Ada Lovelace at Analytical Academy.',
      [{ firstName: 'Ada', lastName: 'Lovelace', organization: 'Analytical Academy' }],
    );
    expect(result).toEqual(['lastName', 'organization']);
    expect(JSON.stringify(result)).not.toContain('Lovelace');
    expect(JSON.stringify(result)).not.toContain('Analytical Academy');
  });

  it('normalizes case and spacing but ignores unsafe short-token matches', () => {
    expect(
      findAnonymizedIdentifierTypes('ORCID 0000-0002-1825-0097; GRACE   HOPPER', [
        { firstName: 'Grace', lastName: 'Hopper', orcid: '0000-0002-1825-0097' },
      ]),
    ).toEqual(['firstName', 'lastName', 'orcid']);
    expect(findAnonymizedIdentifierTypes('Ada is a word here.', [{ firstName: 'Ada' }])).toEqual(
      [],
    );
  });
});
