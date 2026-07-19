import type { CapacitorConfig } from '@capacitor/cli';

/**
 * App iOS embarquant le lecteur mobile (@theatre/reader-runtime).
 *
 * `webDir` pointe sur le build Vite : le shell de l'app est donc **bundlé**, ce qui
 * le rend disponible hors-ligne par construction. Le CONTENU (texte, notes, clips
 * audio), lui, n'est jamais bundlé : il est synchronisé à l'exécution depuis le Mac
 * par « Préparer hors-ligne » et stocké sur le système de fichiers natif. C'est ce
 * qui distingue cette app de l'ancien export .html, qui était un artefact figé.
 *
 * `appId` est l'identité de l'app : en changer plus tard impose une nouvelle App ID
 * et une réinstallation, avec perte des réglages et du stockage local.
 */
const config: CapacitorConfig = {
  appId: 'fr.avolo.theatrereader',
  appName: 'Theatre Reader',
  webDir: 'dist',
  ios: {
    // Le lecteur gère lui-même ses marges ; on laisse la WebView occuper l'écran.
    contentInset: 'always',
  },
};

export default config;
