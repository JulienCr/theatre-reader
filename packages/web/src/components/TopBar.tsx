/**
 * Barre du haut — trois zones, trois natures.
 *
 *   ▸ THEATRE READER │ La Pièce ▾      [ Édition │ Lecture ]      Exporter ▾  ⋯  ⌘K
 *          identité                          mode                     actions
 *
 * Ce qui a changé, et pourquoi : la barre alignait à plat une douzaine de
 * contrôles de natures différentes (boutons, cases à cocher servant
 * d'interrupteurs, segmenté, emoji-icônes) dans un unique `flex`, plus `busy` et
 * `message` **dans le flux** — au point que la moindre notification poussait
 * tout le reste et que la barre passait sur deux lignes dès 1440 px.
 *
 * Trois décisions en découlent :
 *  - la mise en page est une grille `1fr auto 1fr` et non un `flex` libre : le
 *    segmenté est centré sur la fenêtre, pas entre ses voisins, donc il ne bouge
 *    plus quand la gauche ou la droite change de contenu ;
 *  - les notifications sont parties dans des toasts portalisés (cf. `Toasts`) ;
 *  - les actions secondaires sont repliées dans deux menus, ce qui laisse une
 *    unique action primaire visible — la règle d'usage de l'accent (`tokens.ts`)
 *    ne tolère qu'un aplat rouge par écran.
 */
import { Button, Icon, IconButton, Toolbar, ToolbarGroup, ToolbarSeparator } from '@theatre/ui';
import type { PlaySummary } from '../api';
import type { ThemePref } from '../theme';
import {
  Menu,
  MenuCheckItem,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from './ui/Menu';
import { Segmented } from './ui/Segmented';

export interface TopBarProps {
  summaries: PlaySummary[];
  playSlug: string | null;
  playName: string | null;
  mode: 'edit' | 'read';
  onMode: (m: 'edit' | 'read') => void;
  onSelectPlay: (slug: string) => void;
  onImport: () => void;
  onSave: () => void;
  onExportPdf: () => void;
  onExportReader: () => void;
  exportWithAudio: boolean;
  onExportWithAudio: (v: boolean) => void;
  /** Coût ElevenLabs de l'export audio ; `null` = aucune voix assignée. */
  audioEstimate: { chars: number; lines: number } | null;
  /** Nombre de tirades pré-générables ; 0 masque l'entrée de génération. */
  audioBatchCount: number;
  audioRunning: boolean;
  onGenerateAudio: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
}

const MODES: { value: 'edit' | 'read'; label: string }[] = [
  { value: 'edit', label: 'Édition' },
  { value: 'read', label: 'Lecture' },
];

export function TopBar(p: TopBarProps) {
  const hasPlay = p.playSlug != null;

  return (
    <Toolbar className="topbar" aria-label="Barre principale">
      <ToolbarGroup label="Pièce" className="topbar-zone topbar-zone--left">
        <span className="brand">Theatre&nbsp;Reader</span>
        <ToolbarSeparator />
        <Menu
          trigger={
            <Button className="play-trigger">
              <span>{p.playName ?? 'Ouvrir une pièce'}</span>
              <Icon name="chevron-down" size={14} />
            </Button>
          }
        >
          <MenuLabel>Pièces</MenuLabel>
          {p.summaries.length === 0 && <MenuItem onSelect={() => {}} disabled>Aucune pièce</MenuItem>}
          <MenuRadioGroup value={p.playSlug ?? ''} onValueChange={p.onSelectPlay}>
            {p.summaries.map((s) => (
              <MenuRadioItem key={s.slug} value={s.slug}>
                {s.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem onSelect={p.onImport}>Importer un PDF…</MenuItem>
        </Menu>
      </ToolbarGroup>

      <ToolbarGroup label="Mode" className="topbar-zone topbar-zone--center">
        {hasPlay && (
          <Segmented value={p.mode} options={MODES} onChange={p.onMode} label="Mode" />
        )}
      </ToolbarGroup>

      <ToolbarGroup label="Actions" className="topbar-zone topbar-zone--right">
        {hasPlay && (
          <Menu
            align="end"
            trigger={
              <Button variant="primary">
                Exporter
                <Icon name="chevron-down" size={14} />
              </Button>
            }
          >
            <MenuItem onSelect={p.onExportPdf}>Exporter en PDF</MenuItem>
            <MenuItem onSelect={p.onExportReader}>Exporter le lecteur mobile</MenuItem>
            {p.audioEstimate && (
              <>
                <MenuSeparator />
                <MenuCheckItem
                  checked={p.exportWithAudio}
                  onCheckedChange={p.onExportWithAudio}
                  hint={`Réutilise le cache disque (gratuit si déjà généré). Synthèse à la volée pour les répliques manquantes : ~${p.audioEstimate.chars} caractères, ${p.audioEstimate.lines} répliques au plus.`}
                >
                  Embarquer l'audio
                </MenuCheckItem>
              </>
            )}
          </Menu>
        )}

        <Menu
          align="end"
          trigger={<IconButton icon="more-horizontal" label="Autres actions" variant="ghost" />}
        >
          {hasPlay && (
            <>
              <MenuItem onSelect={p.onSave}>Sauvegarder</MenuItem>
              {p.audioBatchCount > 0 && (
                <MenuItem
                  onSelect={p.onGenerateAudio}
                  disabled={p.audioRunning}
                  hint={`${p.audioBatchCount} tirades — réutilise le cache et prépare l'export mobile.`}
                >
                  Générer l'audio
                </MenuItem>
              )}
              <MenuSeparator />
            </>
          )}
          <MenuItem onSelect={p.onToggleFullscreen}>
            {p.isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
          </MenuItem>
          <MenuItem onSelect={p.onOpenShortcuts}>Raccourcis clavier</MenuItem>
          <MenuSeparator />
          <MenuLabel>Thème</MenuLabel>
          <MenuRadioGroup value={p.theme} onValueChange={(v) => p.onTheme(v as ThemePref)}>
            <MenuRadioItem value="system">Système</MenuRadioItem>
            <MenuRadioItem value="light">Clair</MenuRadioItem>
            <MenuRadioItem value="dark">Sombre</MenuRadioItem>
          </MenuRadioGroup>
        </Menu>

        <Button
          variant="ghost"
          className="kbd-trigger"
          title="Palette de commandes (⌘K / Ctrl+K)"
          onClick={p.onOpenPalette}
        >
          ⌘K
        </Button>
      </ToolbarGroup>
    </Toolbar>
  );
}
