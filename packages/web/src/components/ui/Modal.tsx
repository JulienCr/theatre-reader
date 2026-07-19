/**
 * Modale (Radix Dialog) — voile, piège de focus, restitution du focus au
 * déclencheur : tout ce qu'on ne veut pas réécrire à la main.
 *
 * Comme pour `Menu`, le contenu coupe la propagation des touches vers `window`
 * afin que les raccourcis du lecteur ne se déclenchent pas derrière la modale.
 * Radix ferme sur Échap en phase de capture, sa propre sortie reste intacte.
 */
import * as D from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Icon } from '@theatre/ui';

export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="modal-overlay" />
        <D.Content className="modal-card" onKeyDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <D.Title className="modal-title">{title}</D.Title>
            <D.Close className="modal-close" aria-label="Fermer">
              <Icon name="x" size={16} />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
