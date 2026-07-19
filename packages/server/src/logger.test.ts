import { describe, expect, it } from 'vitest';
import { formatLogMessage } from './logger';

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
