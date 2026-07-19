/**
 * Bandeau de contexte posé au-dessus de la barre du lecteur : où l'on est dans
 * la pièce, et le rappel « à toi » quand la répétition attend ma réplique.
 *
 * Présentationnel : le calcul de la scène courante (observation des ancres du
 * sommaire) et l'état du moteur audio restent chez l'appelant.
 */

export interface ContextBannerProps {
  /** Libellé de la scène courante — `null` tant qu'aucun en-tête n'a été franchi. */
  scene?: string | null;
  /** Répétition en pause sur une de mes répliques. */
  waiting?: boolean;
}

export function ContextBanner({ scene, waiting }: ContextBannerProps) {
  // Rien à dire : pas de bandeau vide. Le dock étant ancré en bas, son retrait
  // ne déplace pas la barre.
  if (!scene && !waiting) return null;
  return (
    <div className="ctx-banner">
      {scene && <span className="ctx-banner-scene">{scene}</span>}
      {/* `role="status"` sur la seule mention utile à annoncer : le libellé de
          scène change à chaque défilement, l'annoncer serait du bavardage. */}
      {waiting && (
        <span className="ctx-banner-cue" role="status">
          à toi
        </span>
      )}
    </div>
  );
}
