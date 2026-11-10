import { describe, expect, it } from 'vitest';
import { parseStartAt } from './startAt';

describe('parseStartAt', () => {
  it('reads n: as a tirade and keeps colons inside the node id', () => {
    expect(parseStartAt('n:abc#2')).toEqual({ kind: 'line', value: 'abc#2' });
    expect(parseStartAt('n:a:b')).toEqual({ kind: 'line', value: 'a:b' });
  });

  it('reads h: as a heading id', () => {
    expect(parseStartAt('h:h-4')).toEqual({ kind: 'heading', value: 'h-4' });
  });

  it('treats an unprefixed fragment as a heading id (legacy #h-4)', () => {
    expect(parseStartAt('h-4')).toEqual({ kind: 'heading', value: 'h-4' });
  });
});
