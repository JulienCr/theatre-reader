/**
 * @theatre/ui — jetons de design, icônes et primitives partagés par l'app web
 * et le lecteur mobile exporté.
 *
 * Le CSS est exposé en **chaînes** (`uiCss`) et non en fichiers `.css` : le
 * lecteur mobile est un `.html` autonome hors-ligne dont tout le style est
 * inliné à l'export. Le web injecte exactement la même chaîne, ce qui garantit
 * qu'il n'existe qu'un seul langage visuel.
 */
import { tokensCss } from './tokens';
import { primitivesCss } from './primitives-css';

export { tokensCss } from './tokens';
export { primitivesCss } from './primitives-css';
export { ICONS, FILLED_ICONS, type IconName } from './icons';
export {
  Button,
  Icon,
  IconButton,
  Sheet,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarSpacer,
  type ButtonVariant,
} from './primitives';

/** Jetons + primitives : ce qu'une surface doit injecter au démarrage. */
export const uiCss = tokensCss + primitivesCss;
