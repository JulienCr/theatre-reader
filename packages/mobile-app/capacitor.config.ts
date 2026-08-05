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
    // Le lecteur gère lui-même ses marges, en CSS (`env(safe-area-inset-*)` +
    // `viewport-fit=cover`) : la WebView doit donc occuper l'écran entier et
    // n'ajouter aucun inset de son côté — d'où `never`.
    //
    // `always` (la valeur d'origine) faisait tout le contraire : le scrollView
    // réservait la safe area (62 pt en haut + 34 pt en bas sur un iPhone 17),
    // en double des marges CSS, et le premier affichage peignait le document à
    // `y = 0` au lieu de `y = -contentInset.top` — la page paraissait remontée
    // sous la barre d'état, tout le vide reporté en bas. Seul l'écran d'accueil
    // le montrait : il n'est pas assez long pour défiler et Capacitor met
    // `bounces = false`, donc aucun geste de scroll ne pouvait re-clamper le
    // `contentOffset` — il fallait un pinch. Le lecteur, lui, se remettait droit
    // au premier défilement.
    contentInset: 'never',
  },
};

export default config;
