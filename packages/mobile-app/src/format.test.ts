import { describe, expect, it } from 'vitest';
import { formatAge, formatBytes } from './format';

describe('formatBytes', () => {
  it('reste en Mo pour un cache d’une pièce entière', () => {
    expect(formatBytes(412 * 1024 * 1024)).toBe('412 Mo');
  });

  it('donne une décimale sous 100 Mo, aucune au-dessus', () => {
    expect(formatBytes(12.34 * 1024 * 1024)).toBe('12,3 Mo');
    expect(formatBytes(412.6 * 1024 * 1024)).toBe('413 Mo');
  });

  it('descend en Ko pour un cache minuscule', () => {
    expect(formatBytes(48 * 1024)).toBe('48 Ko');
  });

  it('monte en Go quand il le faut', () => {
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2,5 Go');
  });

  /** Une pièce sans voix configurée : le dossier audio est vide, ce n'est pas une anomalie. */
  it('rend null pour un cache vide, plutôt qu’un « 0 o » à afficher', () => {
    expect(formatBytes(0)).toBeNull();
  });
});

describe('formatAge', () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);
  const ago = (ms: number): string | null => formatAge(now - ms, now);

  it('parle en jours au-delà de 24 h', () => {
    expect(ago(50 * 3600_000)).toBe('il y a 2 j');
  });

  it('parle en heures dans la journée', () => {
    expect(ago(3 * 3600_000)).toBe('il y a 3 h');
  });

  it('dit « à l’instant » sous une minute', () => {
    expect(ago(30_000)).toBe("à l'instant");
  });

  it('parle en minutes entre les deux', () => {
    expect(ago(25 * 60_000)).toBe('il y a 25 min');
  });

  /** Horloge reculée, date écrite par un autre fuseau : mieux vaut taire que mentir. */
  it('rend null pour une date absente ou future', () => {
    expect(formatAge(undefined, now)).toBeNull();
    expect(ago(-3600_000)).toBeNull();
  });
});
