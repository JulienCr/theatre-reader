/**
 * Mises en forme de l'écran d'accueil.
 *
 * Toutes rendent `null` plutôt qu'un texte de remplissage quand la donnée manque
 * ou n'a pas de sens : la ligne d'une pièce se compose en assemblant ce qui est
 * connu, et « 0 o » ou « il y a NaN j » y serait plus déroutant qu'un silence.
 */

const KO = 1024;
const UNITS = [
  { seuil: KO ** 3, suffixe: 'Go' },
  { seuil: KO ** 2, suffixe: 'Mo' },
  { seuil: KO, suffixe: 'Ko' },
];

/** Virgule décimale et espace insécable : c'est du texte français, pas un log. */
function number(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',');
}

/**
 * Poids d'un cache audio, à une décimale près sous 100 unités.
 *
 * La décimale ne survit pas aux grands nombres : « 412,6 Mo » donne à croire à une
 * précision que ce compte n'a pas, et la colonne devient illisible d'une pièce à
 * l'autre.
 */
export function formatBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  for (const { seuil, suffixe } of UNITS) {
    if (bytes >= seuil) {
      const value = bytes / seuil;
      return `${number(value, value < 100 ? 1 : 0).replace(/,0$/, '')} ${suffixe}`;
    }
  }
  return `${Math.round(bytes)} o`;
}

/**
 * Fraîcheur d'une synchronisation, en une unité : au-delà d'un jour, l'heure exacte
 * n'intéresse plus personne — la question posée est « est-ce que c'est à jour ».
 *
 * `now` est un paramètre pour rester testable sans horloge simulée.
 */
export function formatAge(at: number | undefined, now: number = Date.now()): string | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const ms = now - at;
  // Une date future vient d'une horloge reculée ou d'un fichier venu d'ailleurs :
  // aucune formulation honnête, donc rien.
  if (ms < 0) return null;
  if (ms < 60_000) return "à l'instant";
  if (ms < 3600_000) return `il y a ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `il y a ${Math.floor(ms / 3600_000)} h`;
  return `il y a ${Math.floor(ms / 86_400_000)} j`;
}
