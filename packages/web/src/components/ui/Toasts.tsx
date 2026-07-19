/**
 * Notifications transitoires (Radix Toast).
 *
 * Raison d'être : `busy` et `message` étaient deux `<span>` **dans le flux** de
 * la barre du haut. Leur apparition poussait tous les contrôles à sa droite —
 * à chaque sauvegarde, à chaque import. Portalisés hors du flux, ils ne peuvent
 * plus déplacer quoi que ce soit.
 *
 * Deux natures distinctes, donc deux traitements : `busy` dure aussi longtemps
 * que l'opération (pas de temporisation, c'est l'appelant qui le retire),
 * `message` est un compte rendu qui s'efface tout seul.
 */
import * as T from '@radix-ui/react-toast';

/** Un message identique deux fois de suite doit réapparaître : d'où l'`id`. */
export interface FlashMessage {
  id: number;
  text: string;
}

const MESSAGE_MS = 4000;
/** Radix attend un nombre fini ; `Infinity` serait ramené à 0 par setTimeout. */
const NEVER = 1_000_000_000;

export function Toasts({
  busy,
  message,
  onDismissMessage,
}: {
  busy: string | null;
  message: FlashMessage | null;
  onDismissMessage: () => void;
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
      <T.Viewport className="toast-viewport" />
    </T.Provider>
  );
}
