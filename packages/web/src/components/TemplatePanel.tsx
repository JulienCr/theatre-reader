/**
 * Panneau « Mise en page » — mise en forme du texte et des en-têtes.
 *
 * Les neuf sections `<h4>` empilées faisaient 1225 px de contenu pour 823 px
 * visibles : on réglait une didascalie en gardant en mémoire où se trouvait
 * l'en-tête de scène. Elles sont désormais réparties en deux sous-onglets, et
 * Radix démonte l'inactif — c'est ce démontage qui coupe la hauteur, pas un
 * `max-height`.
 *
 * La section « Page » (format, police, taille, marge, interligne) a quitté ce
 * panneau : ces cinq réglages se jugent à l'œil sur l'aperçu, ils vivent
 * maintenant dans la barre au-dessus de lui (`Workspace.tsx`). Ils écrivent dans
 * le même `template.page` — un seul emplacement, pas une copie.
 */
import { useState } from 'react';
import type { HeadingStyle, Template } from '@theatre/core';
import { Check, ColorField, NumberField, Row, Select, TextField, ToggleColor } from './controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';

/** Contrôles de style d'un en-tête (acte ou scène) : typo, alignement, fond, encadré. */
function HeadingControls({
  style,
  onChange,
}: {
  style: HeadingStyle;
  onChange: (patch: Partial<HeadingStyle>) => void;
}) {
  return (
    <>
      <Check label="Gras" checked={style.bold} onChange={(v) => onChange({ bold: v })} />
      <Check label="Majuscules" checked={style.caps} onChange={(v) => onChange({ caps: v })} />
      <Row label="Alignement">
        <Select<HeadingStyle['align']>
          value={style.align}
          options={[
            { value: 'left', label: 'Gauche' },
            { value: 'center', label: 'Centre' },
            { value: 'right', label: 'Droite' },
          ]}
          onChange={(align) => onChange({ align })}
        />
      </Row>
      <ToggleColor
        label="Couleur du texte"
        value={style.color}
        defaultColor="#1a3c6e"
        onChange={(color) => onChange({ color })}
      />
      <ToggleColor
        label="Fond"
        value={style.background}
        defaultColor="#ffebc8"
        onChange={(background) => onChange({ background })}
      />
      <ToggleColor
        label="Encadré"
        value={style.border ? (style.borderColor ?? '#333333') : undefined}
        defaultColor="#333333"
        onChange={(v) => onChange({ border: v != null, borderColor: v ?? style.borderColor })}
      />
      <Row label="Taille">
        <NumberField
          value={style.fontSizeEm ?? 1}
          min={0.8}
          max={3}
          step={0.1}
          onChange={(v) => onChange({ fontSizeEm: v })}
        />
      </Row>
    </>
  );
}

export function TemplatePanel({
  template,
  onChange,
}: {
  template: Template;
  onChange: (t: Template) => void;
}) {
  const t = template;
  const [tab, setTab] = useState('text');
  const setName = (patch: Partial<Template['characterName']>) =>
    onChange({ ...t, characterName: { ...t.characterName, ...patch } });
  const setStage = (patch: Partial<Template['stageDirection']>) =>
    onChange({ ...t, stageDirection: { ...t.stageDirection, ...patch } });
  const setInline = (patch: Partial<Template['inlineStageDirection']>) =>
    onChange({ ...t, inlineStageDirection: { ...t.inlineStageDirection, ...patch } });
  const setScene = (patch: Partial<Template['sceneHeading']>) =>
    onChange({ ...t, sceneHeading: { ...t.sceneHeading, ...patch } });
  const setAct = (patch: Partial<Template['actHeading']>) =>
    onChange({ ...t, actHeading: { ...t.actHeading, ...patch } });

  return (
    <section className="panel">
      <Tabs value={tab} onValueChange={setTab} className="subtabs">
        <TabsList label="Sections de mise en page">
          <TabsTrigger value="text">Texte</TabsTrigger>
          <TabsTrigger value="headings">En-têtes</TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <h4>Nom du personnage</h4>
          <Check label="Gras" checked={t.characterName.bold} onChange={(v) => setName({ bold: v })} />
          <Check
            label="Majuscules"
            checked={t.characterName.caps}
            onChange={(v) => setName({ caps: v })}
          />
          <Check
            label="Réplique à la ligne"
            checked={!t.characterName.sameLineAsDialogue}
            onChange={(v) => setName({ sameLineAsDialogue: !v })}
          />
          {t.characterName.sameLineAsDialogue && (
            <Row label="Séparateur">
              <TextField value={t.characterName.suffix} onChange={(v) => setName({ suffix: v })} />
            </Row>
          )}

          <h4>Didascalies (isolées)</h4>
          <Check
            label="Italique"
            checked={t.stageDirection.italic}
            onChange={(v) => setStage({ italic: v })}
          />
          <Check
            label="Indenter"
            checked={t.stageDirection.indent}
            onChange={(v) => setStage({ indent: v })}
          />
          <Check
            label="Masquer"
            checked={t.stageDirection.hidden}
            onChange={(v) => setStage({ hidden: v })}
          />
          <Row label="Couleur">
            <ColorField value={t.stageDirection.color ?? '#6b6b6b'} onChange={(v) => setStage({ color: v })} />
          </Row>

          <h4>Didascalies en incise</h4>
          <Check
            label="Italique"
            checked={t.inlineStageDirection.italic}
            onChange={(v) => setInline({ italic: v })}
          />
          <Check
            label="Masquer"
            checked={t.inlineStageDirection.hidden}
            onChange={(v) => setInline({ hidden: v })}
          />
          <Row label="Couleur">
            <ColorField
              value={t.inlineStageDirection.color ?? '#6b6b6b'}
              onChange={(v) => setInline({ color: v })}
            />
          </Row>
        </TabsContent>

        <TabsContent value="headings">
          <h4>Structure</h4>
          <Check
            label="Afficher la présentation des personnages"
            checked={t.showDistribution !== false}
            onChange={(v) => onChange({ ...t, showDistribution: v })}
          />
          {t.showDistribution !== false && (
            <Check
              label="Saut de page après la distribution"
              checked={t.distributionPageBreak !== false}
              onChange={(v) => onChange({ ...t, distributionPageBreak: v })}
            />
          )}
          <Check
            label="Sommaire (actes/scènes + n° de page)"
            checked={t.showToc !== false}
            onChange={(v) => onChange({ ...t, showToc: v })}
          />
          <Check
            label="Numéroter les pages (page x / y)"
            checked={t.pageNumbers !== false}
            onChange={(v) => onChange({ ...t, pageNumbers: v })}
          />
          <Check
            label="Afficher l'acte avec chaque scène"
            checked={t.sceneHeading.showAct}
            onChange={(v) => setScene({ showAct: v })}
          />

          <h4>En-tête d'acte</h4>
          <HeadingControls style={t.actHeading} onChange={setAct} />

          <h4>En-tête de scène</h4>
          <HeadingControls style={t.sceneHeading} onChange={setScene} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
