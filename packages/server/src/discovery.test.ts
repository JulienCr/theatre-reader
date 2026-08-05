import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './discovery';

/**
 * Le prédicat décide si l'on annonce `theatre-reader.local`. Se tromper dans un sens
 * coupe la découverte ; dans l'autre, on annonce un nom qui résout vers l'IP LAN alors
 * que le serveur n'écoute que sur la loopback — le téléphone se connecte et se fait
 * refuser, sans que rien n'explique pourquoi.
 */
describe('isLoopbackHost', () => {
  it('reconnaît les écritures de la loopback', () => {
    for (const host of ['127.0.0.1', 'localhost', 'LocalHost', '::1', '[::1]', '127.1.2.3']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('laisse passer les adresses qui exposent réellement le serveur', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.32', '10.0.0.5', 'theatre-reader.local']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it('ne se laisse pas berner par un hôte qui commence par 127', () => {
    // `127.0.0.1.example.com` sort bien sur le réseau : un `startsWith` dirait loopback.
    expect(isLoopbackHost('127.0.0.1.example.com')).toBe(false);
    expect(isLoopbackHost('1270.0.0.1')).toBe(false);
  });
});
