/**
 * Liste des raccourcis clavier — source unique, affichée à deux endroits :
 * l'aide contextuelle du lecteur (touche « ? ») et l'entrée « Raccourcis » du
 * menu ⋯ de la barre du haut. Dupliquer la liste, c'est la laisser diverger.
 */
export const SHORTCUTS: [string, string][] = [
  ['⌘K  /  Ctrl+K', 'Palette de commandes'],
  ['/', 'Rechercher (lecteur)'],
  ['n  ·  p', 'Résultat suivant · précédent'],
  ['g', 'Aller à une page'],
  ['+  ·  -  ·  0', 'Zoom avant · arrière · réinitialiser'],
  ['Espace', 'Lecture / pause · reprend (dit ta réplique)'],
  ['.  ·  ,', 'Réplique audio suivante · précédente'],
  ['m', 'Mode de lecture (continu / répétition…)'],
  ['f', 'Plein écran'],
  ['?', 'Afficher / masquer cette aide'],
  ['Échap', 'Fermer le lecteur'],
];

export function ShortcutList() {
  return (
    <dl>
      {SHORTCUTS.map(([k, d]) => (
        <div className="help-row" key={k}>
          <dt>
            <kbd>{k}</kbd>
          </dt>
          <dd>{d}</dd>
        </div>
      ))}
    </dl>
  );
}
