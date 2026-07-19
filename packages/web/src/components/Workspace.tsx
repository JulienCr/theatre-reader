/**
 * Espace d'édition — rail, aperçu, tiroir de source, dock à onglets.
 *
 *   ┌───┬───────────────────────────┬───────────────┐
 *   │ ▣ │ A4 · police · pt · marge  │ Distribution  │
 *   │ ▣ │          APERÇU           │ Mise en page  │
 *   │ ▣ │                           │ Notes         │
 *   │   ├───────────────────────────┼───────────────┤
 *   │   │ ▾ Source (Fountain)       │   (panneau)   │
 *   └───┴───────────────────────────┴───────────────┘
 *
 * Ce qui a changé, et pourquoi : les quatre panneaux de réglages étaient empilés
 * dans une colonne de 320 px en `overflow-y: auto`. Tout était visible en même
 * temps, donc rien n'était trouvable, et la colonne défilait sur plusieurs
 * milliers de pixels — sur une pièce à douze rôles, chaque personnage
 * apparaissait deux fois (Personnages, puis Voix) avant même d'atteindre les
 * soixante contrôles de mise en page.
 *
 * Trois décisions en découlent :
 *  - **un seul panneau monté à la fois** (Radix Tabs démonte l'inactif) : c'est
 *    ce qui divise la hauteur de défilement, pas un `max-height` ;
 *  - **un rail d'icônes** qui ouvre *et* referme le dock : replié, l'aperçu
 *    récupère toute la largeur — le geste manquait complètement ;
 *  - **des séparateurs déplaçables** dont les tailles sont persistées
 *    (`autoSaveId` → localStorage) : les trois colonnes étaient figées, on ne
 *    pouvait pas donner plus de place à l'aperçu.
 *
 * Ce composant ne connaît que la **disposition** : le contenu des panneaux lui
 * arrive en `ReactNode`. C'est ce qui permet de refondre l'un sans toucher à
 * l'autre.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { Icon, IconButton, Sheet, Toolbar, ToolbarGroup, type IconName } from '@theatre/ui';
import type { PageStyle, Template } from '@theatre/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { NumberField, Select, TextField } from './controls';
import { useMediaQuery } from '../useMediaQuery';

export interface DockPanel {
  id: string;
  label: string;
  icon: IconName;
  content: ReactNode;
}

/** En dessous, le dock ne tient plus en colonne sans écraser l'aperçu. */
const WIDE = '(min-width: 1100px)';

const DOCK_KEY = 'theatre.workspace.dock';
/**
 * Sentinelle « replié ». Effacer la clé ne suffirait pas : l'absence de clé,
 * c'est la première visite, et une première visite ouvre le dock. Sans cette
 * valeur explicite, replier le dock puis recharger le rouvrirait.
 */
const DOCK_CLOSED = '';

/** `null` = dock replié. Lu une seule fois, à l'initialisation de l'état. */
function loadDock(panels: DockPanel[]): string | null {
  const saved = localStorage.getItem(DOCK_KEY);
  if (saved === null) return panels[0]?.id ?? null;
  if (saved === DOCK_CLOSED) return null;
  // Un onglet disparu (panneau renommé, version antérieure) ne doit pas laisser
  // le dock ouvert sur du vide.
  return panels.some((p) => p.id === saved) ? saved : null;
}

/**
 * Réglages de la feuille, posés au-dessus de l'aperçu.
 *
 * Pourquoi ici et non dans le panneau « Mise en page » : format, police, taille,
 * marge et interligne se jugent à l'œil, sur la page. Les chercher dans un
 * onglet latéral obligeait à faire l'aller-retour du regard à chaque demi-point.
 * Ils écrivent dans le même `template.page` que partout ailleurs — ce n'est pas
 * une copie de l'état, c'est le même.
 *
 * `ToolbarGroup` porte le découpage : un groupe est indivisible, donc la barre
 * ne se réagence pas au gré de la largeur de la colonne.
 */
function PageBar({
  template,
  onChange,
}: {
  template: Template;
  onChange: (t: Template) => void;
}) {
  const setPage = (patch: Partial<PageStyle>) =>
    onChange({ ...template, page: { ...template.page, ...patch } });
  const p = template.page;
  return (
    <Toolbar className="ws-pagebar" aria-label="Réglages de la feuille">
      <ToolbarGroup label="Format">
        <Select<PageStyle['format']>
          value={p.format}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'Letter', label: 'Letter' },
          ]}
          onChange={(format) => setPage({ format })}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Police">
        <TextField
          className="ws-pagebar-font"
          aria-label="Police"
          value={p.fontFamily}
          onChange={(fontFamily) => setPage({ fontFamily })}
        />
        <label className="ws-pagebar-field">
          <span>pt</span>
          <NumberField
            value={p.fontSizePt}
            min={6}
            max={32}
            step={0.5}
            onChange={(fontSizePt) => setPage({ fontSizePt })}
          />
        </label>
      </ToolbarGroup>
      <ToolbarGroup label="Page">
        <label className="ws-pagebar-field">
          <span>Marge</span>
          <NumberField
            value={p.marginMm}
            min={0}
            max={50}
            onChange={(marginMm) => setPage({ marginMm })}
          />
        </label>
        <label className="ws-pagebar-field">
          <span>Interligne</span>
          <NumberField
            value={p.lineHeight}
            min={1}
            max={3}
            step={0.05}
            onChange={(lineHeight) => setPage({ lineHeight })}
          />
        </label>
      </ToolbarGroup>
    </Toolbar>
  );
}

export function Workspace({
  panels,
  template,
  onTemplateChange,
  preview,
  source,
  sourceOpen,
  onSourceOpen,
  isFullscreen,
}: {
  panels: DockPanel[];
  template: Template;
  onTemplateChange: (t: Template) => void;
  preview: ReactNode;
  source: ReactNode;
  sourceOpen: boolean;
  onSourceOpen: (v: boolean) => void;
  isFullscreen: boolean;
}) {
  const [dock, setDock] = useState<string | null>(() => loadDock(panels));
  // État propre à la fenêtre étroite. Séparé de `dock`, et volontairement non
  // persisté : la sheet est modale, elle voile tout l'écran (rail compris). Si
  // elle héritait de l'état de la colonne, rétrécir la fenêtre — ou simplement
  // rouvrir l'app en étroit — ferait surgir une modale par-dessus l'aperçu, sans
  // que personne l'ait demandée.
  const [sheet, setSheet] = useState<string | null>(null);
  const wide = useMediaQuery(WIDE);

  useEffect(() => {
    if (wide) setSheet(null);
  }, [wide]);

  // Tailles persistées dans localStorage. `panelIds` est indispensable ici : les
  // deux groupes ont des panneaux conditionnels, et sans lui la bibliothèque
  // réappliquerait au démarrage la mise en page enregistrée pour un autre jeu de
  // panneaux (dock replié → dock ouvert, par exemple).
  const cols = useDefaultLayout({
    id: 'theatre.workspace.h',
    panelIds: ['center', 'dock'],
    storage: localStorage,
    onlySaveAfterUserInteractions: true,
  });
  const rows = useDefaultLayout({
    id: 'theatre.workspace.v',
    panelIds: ['preview', 'source'],
    storage: localStorage,
    onlySaveAfterUserInteractions: true,
  });

  useEffect(() => {
    localStorage.setItem(DOCK_KEY, dock ?? DOCK_CLOSED);
  }, [dock]);

  const select = wide ? setDock : setSheet;
  // Un clic sur l'onglet déjà actif referme : c'est le seul geste qui rend toute
  // la largeur à l'aperçu, et il doit vivre là où on l'a ouvert.
  const toggle = (id: string) => select((cur) => (cur === id ? null : id));

  // Plein écran immersif : rail, dock, tiroir et séparateurs disparaissent tous.
  // Piloté en JS et non en CSS — masquer un `Panel` en `display: none` lui
  // laisserait son pourcentage de largeur, donc un trou.
  const chrome = !isFullscreen;
  const activeId = wide ? dock : sheet;
  const dockOpen = chrome && activeId !== null;
  const active = panels.find((p) => p.id === activeId);

  const dockBody = active && (
    <Tabs value={active.id} onValueChange={select}>
      <TabsList label="Panneaux de réglages">
        {panels.map((p) => (
          <TabsTrigger key={p.id} value={p.id}>
            {p.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {panels.map((p) => (
        <TabsContent key={p.id} value={p.id}>
          {p.content}
        </TabsContent>
      ))}
    </Tabs>
  );

  return (
    <main className="workspace">
      {chrome && (
        <nav className="ws-rail" aria-label="Panneaux">
          {panels.map((p) => (
            <IconButton
              key={p.id}
              icon={p.icon}
              label={p.label}
              variant="ghost"
              pressed={activeId === p.id}
              onClick={() => toggle(p.id)}
            />
          ))}
        </nav>
      )}

      {/* Les tailles sont données en chaînes : un nombre serait interprété en
          pixels par la bibliothèque, une chaîne en pourcentage du groupe. */}
      <Group
        orientation="horizontal"
        id="ws-cols"
        className="ws-cols"
        defaultLayout={cols.defaultLayout}
        onLayoutChanged={cols.onLayoutChanged}
      >
        <Panel id="center" minSize="30%" className="ws-center">
          <Group
            orientation="vertical"
            id="ws-rows"
            className="ws-rows"
            defaultLayout={rows.defaultLayout}
            onLayoutChanged={rows.onLayoutChanged}
          >
            <Panel id="preview" minSize="20%" className="ws-preview">
              {/* Masquée en plein écran comme le reste du chrome. */}
              {chrome && <PageBar template={template} onChange={onTemplateChange} />}
              {preview}
            </Panel>
            {chrome && sourceOpen && <Separator className="ws-handle ws-handle--h" />}
            {chrome && sourceOpen && (
              <Panel id="source" defaultSize="34%" minSize="12%" className="ws-drawer">
                <button
                  type="button"
                  className="ws-drawer-head"
                  aria-expanded={true}
                  onClick={() => onSourceOpen(false)}
                >
                  <Icon name="chevron-down" size={14} />
                  <span>Source (Fountain)</span>
                </button>
                {source}
              </Panel>
            )}
          </Group>

          {/* Replié, le tiroir laisse sa poignée en pied de colonne : sans elle
              le masquage serait une porte à sens unique. */}
          {chrome && !sourceOpen && (
            <button
              type="button"
              className="ws-drawer-head ws-drawer-head--collapsed"
              aria-expanded={false}
              onClick={() => onSourceOpen(true)}
            >
              <Icon name="chevron-right" size={14} />
              <span>Source (Fountain)</span>
            </button>
          )}
        </Panel>

        {dockOpen && wide && <Separator className="ws-handle ws-handle--v" />}
        {dockOpen && wide && (
          <Panel id="dock" defaultSize="24%" minSize="16%" maxSize="45%" className="ws-dock">
            {dockBody}
          </Panel>
        )}
      </Group>

      {/* Titre générique : les onglets vivent dans la sheet et nomment déjà le
          panneau — le reprendre en en-tête l'écrirait deux fois. */}
      {chrome && !wide && (
        <Sheet open={dockOpen} title="Réglages" onClose={() => setSheet(null)}>
          {dockBody}
        </Sheet>
      )}
    </main>
  );
}
