import { describe, expect, it } from 'vitest';
import { formatLogMessage, parseLevel } from './logger';

describe('parseLevel', () => {
  it('accepte les niveaux connus, quelle que soit la casse', () => {
    expect(parseLevel('debug')).toBe('debug');
    expect(parseLevel('SILENT')).toBe('silent');
  });

  it('retombe sur info quand la valeur est absente ou inconnue', () => {
    expect(parseLevel(undefined)).toBe('info');
    expect(parseLevel('bavard')).toBe('info');
  });

  // `raw in ORDER` les laissait passer : `threshold` valait alors `undefined` et
  // plus aucun message n'était filtré.
  it("refuse les propriétés héritées d'Object.prototype", () => {
    expect(parseLevel('constructor')).toBe('info');
    expect(parseLevel('toString')).toBe('info');
    expect(parseLevel('valueOf')).toBe('info');
  });
});

describe('formatLogMessage', () => {
  it('rend un appel `(msg)` et `(msg, extra)`', () => {
    expect(formatLogMessage(['serveur prêt'])).toBe('serveur prêt');
    expect(formatLogMessage(['port', 3001])).toBe('port 3001');
  });

  it('joint le message et la pile pour un appel `(err, msg)`', () => {
    const err = new Error('boum');
    const line = formatLogMessage([err, 'export raté']);
    expect(line).toContain('export raté');
    expect(line).toContain('boum');
    expect(line).toContain('logger.test.ts');
  });

  // Fastify journalise ses échecs sous la forme `({ req, res, err }, message)` :
  // sans extraction, seul le message générique survivrait.
  it("conserve la pile d'une erreur imbriquée dans un objet pino", () => {
    const err = new Error('boum');
    const line = formatLogMessage([{ req: {}, res: {}, err }, 'request errored']);
    expect(line).toContain('request errored');
    expect(line).toContain('boum');
    expect(line).toContain('logger.test.ts');
  });

  it('ne plante pas sur un objet circulaire sans message', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => formatLogMessage([circular])).not.toThrow();
  });
});
