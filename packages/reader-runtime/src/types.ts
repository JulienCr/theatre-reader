/**
 * Données injectées dans le .html exporté (`window.__THEATRE_READER_DATA__`).
 *
 * Le type est déclaré une seule fois, dans @theatre/reader-ui, avec la fonction
 * qui le produit (`buildReaderDocument`) : deux déclarations du même contrat
 * divergeraient, et l'erreur ne se verrait qu'à l'exécution.
 *
 * Ré-exporté ici (et non importé directement d'`index.ts`) pour que le chrome
 * React puisse le typer sans importer le module de démarrage — qui l'importe
 * déjà : ça éviterait un cycle.
 */
export type { ReaderData } from '@theatre/reader-ui';
