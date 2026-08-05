/**
 * Notifications transitoires (Radix Toast).
 *
 * Raison d'être : `busy` et `message` étaient deux `<span>` **dans le flux** de
 * la barre du haut. Leur apparition poussait tous les contrôles à sa droite —
 * à chaque sauvegarde, à chaque import. Portalisés hors du flux, ils ne peuvent
 * plus déplacer quoi que ce soit.
 *
 * Trois natures distinctes, donc trois traitements : `busy` dure aussi longtemps
 * que l'opération (pas de temporisation, c'est l'appelant qui le retire),
 * `message` est un compte rendu qui s'efface tout seul, et `failures` ne part
 * jamais de lui-même — il porte du contenu non enregistré, qui disparaîtrait
 * avec lui.
 */
import * as T from '@radix-ui/react-toast';

/** Un message identique deux fois de suite doit réapparaître : d'où l'`id`. */
export interface FlashMessage {
  id: number;
  text: string;
}

/**
 * Écriture perdue dont le contenu est encore récupérable.
 *
 * Un toast fugace ne convient pas ici : l'échec porte sur une pièce qu'on a pu
 * quitter entre-temps, et son contenu n'est alors plus nulle part — ni à
 * l'écran, ni sur le disque. `retry` le tient dans sa fermeture, ce qui est le
 * seul moyen de le rejouer.
 */
export interface SaveFailure {
  id: number;
  playName: string;
  what: string;
  retry: () => void;
}

const MESSAGE_MS = 4000;
/** Radix attend un nombre fini ; `Infinity` serait ramené à 0 par setTimeout. */
const NEVER = 1_000_000_000;

export function Toasts({
  busy,
  message,
  failures,
  onDismissMessage,
  onDismissFailure,
}: {
  busy: string | null;
  message: FlashMessage | null;
  failures: SaveFailure[];
  onDismissMessage: () => void;
  onDismissFailure: (id: number) => void;
}) {
  return (
    <T.Provider swipeDirection="right">
      {busy && (
        <T.Root className="toast toast--busy" open duration={NEVER}>
          <span className="toast-spin" aria-hidden="true" />
          <T.Description className="toast-text">{busy}</T.Description>
        </T.Root>
      )}
      {message && (
        <T.Root
          key={message.id}
          className="toast"
          open
          duration={MESSAGE_MS}
          onOpenChange={(o) => {
            if (!o) onDismissMessage();
          }}
        >
          <T.Description className="toast-text">{message.text}</T.Description>
          <T.Close className="toast-close" aria-label="Fermer">
            ✕
          </T.Close>
        </T.Root>
      )}
      {/* `duration` infinie ET pas de fermeture au survol/à l'échappement : rien
          ne doit escamoter un échec d'écriture, seule une action le retire. */}
      {failures.map((f) => (
        <T.Root key={f.id} className="toast toast--error" open duration={NEVER}>
          <T.Description className="toast-text">
            {f.what} de « {f.playName} » : échec de l'enregistrement.
          </T.Description>
          <T.Action asChild altText="Réessayer l'enregistrement">
            <button type="button" className="toast-action" onClick={f.retry}>
              Réessayer
            </button>
          </T.Action>
          <T.Close className="toast-close" aria-label="Ignorer" onClick={() => onDismissFailure(f.id)}>
            ✕
          </T.Close>
        </T.Root>
      ))}
      <T.Viewport className="toast-viewport" />
    </T.Provider>
  );
}
