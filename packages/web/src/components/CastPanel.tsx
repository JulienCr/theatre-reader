/**
 * Panneau « Distribution » — une seule ligne par personnage.
 *
 * Pourquoi ce fichier remplace `CharactersPanel` + `VoicesPanel` : les deux
 * listaient exactement les mêmes rôles, l'un sous l'autre, dans le même onglet.
 * Sur une pièce à douze personnages, chaque nom apparaissait deux fois et
 * l'onglet mesurait 1580 px de contenu pour 823 px visibles — on cherchait un
 * personnage, on tombait sur son double, et le rapport entre les deux lignes
 * n'était porté par rien d'autre que leur ordre.
 *
 * Ici, tout ce qui concerne un rôle tient sur sa ligne : surlignage (case,
 * couleur, portée), voix ElevenLabs, « mon rôle », et — au dépliage — nom,
 * description, alias et fusion. La logique métier est reprise telle quelle des
 * deux anciens panneaux ; c'est la disposition qui change, pas le comportement.
 *
 * Deux ajouts pour tenir au-delà d'une vingtaine de rôles : un champ de filtre,
 * et une section « autres » repliée qui range les personnages sans surlignage
 * ni voix — ceux qu'on ne règle pas occupent la place de ceux qu'on règle.
 */
import { useMemo, useState } from 'react';
import type { AudioConfig, Character, HighlightScope, Template } from '@theatre/core';
import { Icon } from '@theatre/ui';
import * as api from '../api';
import type { VoiceSummary } from '../api';
import { ColorField, Select, TextField } from './controls';

// Teintes pâles (fond de surlignage lisible) — p.ex. orange = rgb(255,235,200).
const PALETTE = ['#fff6c8', '#ffebc8', '#ddf0d2', '#d7e9fb', '#fbdce8', '#ecdcf5', '#d5f0ec'];

const PREVIEW_TEXT = 'Bonjour, ceci est un essai de voix.';

/** Comparaison tolérante aux accents et à la casse — on filtre en tapant vite. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function CastPanel({
  characters,
  template,
  audio,
  voices,
  slug,
  onTemplateChange,
  onCharactersChange,
  onAudioChange,
}: {
  characters: Character[];
  template: Template;
  audio: AudioConfig;
  /** `null` = pas de clé ElevenLabs : la colonne voix disparaît entièrement. */
  voices: VoiceSummary[] | null;
  slug: string;
  onTemplateChange: (t: Template) => void;
  onCharactersChange: (c: Character[]) => void;
  onAudioChange: (a: AudioConfig) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  // ---- Surlignage (repris de CharactersPanel) ----
  const highlightOf = (id: string) => template.highlights.find((h) => h.characterId === id);

  const updateHighlight = (id: string, next: { color: string; scope: HighlightScope } | null) => {
    const others = template.highlights.filter((h) => h.characterId !== id);
    onTemplateChange({
      ...template,
      highlights: next ? [...others, { characterId: id, ...next }] : others,
    });
  };

  // ---- Édition d'un personnage (repris de CharactersPanel) ----
  const patchChar = (id: string, patch: Partial<Character>) =>
    onCharactersChange(characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const mergeInto = (sourceId: string, targetId: string) => {
    const source = characters.find((c) => c.id === sourceId);
    if (!source) return;
    onCharactersChange(
      characters
        .map((c) =>
          c.id === targetId
            ? {
                ...c,
                aliases: [...new Set([...c.aliases, ...source.aliases, source.canonicalName])],
                description: c.description ?? source.description,
              }
            : c,
        )
        .filter((c) => c.id !== sourceId),
    );
    // Retire un éventuel surlignage du personnage absorbé (référence orpheline).
    if (highlightOf(sourceId)) {
      onTemplateChange({
        ...template,
        highlights: template.highlights.filter((h) => h.characterId !== sourceId),
      });
    }
    setExpanded(null);
  };

  // ---- Voix (repris de VoicesPanel) ----
  const voiceOf = (cid: string) => audio.voices?.[cid] ?? '';

  const setVoice = (cid: string, voiceId: string) => {
    const next = { ...(audio.voices ?? {}) };
    if (voiceId) next[cid] = voiceId;
    else delete next[cid];
    onAudioChange({ ...audio, voices: next });
  };

  const setMine = (cid: string) => {
    onAudioChange({ ...audio, myCharacterId: audio.myCharacterId === cid ? undefined : cid });
  };

  const autoAssign = () => {
    if (!voices?.length) return;
    const next: Record<string, string> = { ...(audio.voices ?? {}) };
    characters.forEach((c, i) => {
      if (!next[c.id]) next[c.id] = voices[i % voices.length]!.voiceId;
    });
    onAudioChange({ ...audio, voices: next });
  };

  const preview = async (cid: string) => {
    const voiceId = voiceOf(cid);
    if (!voiceId) return;
    setError(null);
    setPreviewing(cid);
    try {
      const blob = await api.tts(slug, { text: PREVIEW_TEXT, voiceId, model: audio.model });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      const revoke = () => URL.revokeObjectURL(url);
      a.onended = revoke;
      a.onerror = revoke;
      // play() rejette si l'autoplay est bloqué : révoquer aussi dans ce cas.
      await a.play().catch((e) => {
        revoke();
        throw e;
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setPreviewing(null);
    }
  };

  // ---- Répartition actifs / autres ----
  // « Actif » = réglé (surligné ou doté d'une voix) ou déplié. Un personnage
  // qu'on vient d'ouvrir ne doit pas disparaître sous ses pieds au premier clic.
  // Sans clé ElevenLabs, une voix enregistrée ne compte pas : elle n'est ni
  // visible ni modifiable, elle ne peut donc pas justifier une place en haut.
  const isActive = (c: Character) =>
    Boolean(highlightOf(c.id)) || (voices !== null && Boolean(voiceOf(c.id))) || expanded === c.id;

  const { active, others } = useMemo(() => {
    const q = fold(filter.trim());
    const match = (c: Character) =>
      !q || fold(c.canonicalName).includes(q) || c.aliases.some((a) => fold(a).includes(q));
    const kept = characters.filter(match);
    return { active: kept.filter(isActive), others: kept.filter((c) => !isActive(c)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters, filter, template.highlights, audio.voices, expanded]);

  // La section repliée ne se justifie que si l'autre a de quoi montrer : sans
  // personnage réglé, replier « autres » ouvrirait le panneau sur du vide. Un
  // filtre en cours force l'ouverture — on cherche justement là-dedans.
  const othersOpen = showOthers || active.length === 0 || filter.trim() !== '';

  const assigned = characters.filter((c) => voiceOf(c.id)).length;

  const renderItem = (c: Character, i: number) => {
    const hl = highlightOf(c.id);
    const open = expanded === c.id;
    const vid = voiceOf(c.id);
    const mine = audio.myCharacterId === c.id;
    return (
      <li key={c.id} className="cast-item">
        <div className="cast-row">
          <input
            type="checkbox"
            title="Surligner ce personnage"
            aria-label={`Surligner ${c.canonicalName}`}
            checked={Boolean(hl)}
            onChange={(e) =>
              updateHighlight(
                c.id,
                e.target.checked
                  ? {
                      color: hl?.color ?? PALETTE[i % PALETTE.length]!,
                      scope: hl?.scope ?? 'replique',
                    }
                  : null,
              )
            }
          />
          {hl && (
            <ColorField
              value={hl.color}
              onChange={(color) => updateHighlight(c.id, { color, scope: hl.scope })}
            />
          )}
          <button
            type="button"
            className="char-name-btn"
            aria-expanded={open}
            onClick={() => setExpanded(open ? null : c.id)}
          >
            <span className="char-name">{c.canonicalName}</span>
            {!c.description && (
              <span className="badge" title="Absent de la distribution — à vérifier">
                ?
              </span>
            )}
            <span className="chevron">{open ? '▾' : '▸'}</span>
          </button>
          <label
            className="cast-mine"
            title="Le rôle que je joue — silencieux en mode Répétition"
          >
            <input type="checkbox" checked={mine} onChange={() => setMine(c.id)} />
            moi
          </label>
        </div>

        {(hl || voices) && (
          <div className="cast-row cast-row--controls">
            {hl && (
              <Select<HighlightScope>
                value={hl.scope}
                options={[
                  { value: 'replique', label: 'Réplique entière' },
                  { value: 'name', label: 'Nom seulement' },
                ]}
                onChange={(scope) => updateHighlight(c.id, { color: hl.color, scope })}
              />
            )}
            {voices && (
              <>
                <select
                  className="cast-voice"
                  aria-label={`Voix de ${c.canonicalName}`}
                  value={vid}
                  onChange={(e) => setVoice(c.id, e.target.value)}
                >
                  <option value="">— aucune voix —</option>
                  {voices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="cast-preview"
                  title="Écouter un essai"
                  aria-label={`Écouter un essai de la voix de ${c.canonicalName}`}
                  disabled={!vid || previewing === c.id}
                  onClick={() => preview(c.id)}
                >
                  {previewing === c.id ? '…' : <Icon name="volume" size={14} />}
                </button>
              </>
            )}
          </div>
        )}

        {open && (
          <div className="char-edit">
            <label className="edit-row">
              <span>Nom</span>
              <input
                type="text"
                value={c.canonicalName}
                onChange={(e) => patchChar(c.id, { canonicalName: e.target.value })}
              />
            </label>
            <label className="edit-row edit-row--col">
              <span>Description</span>
              <textarea
                rows={4}
                value={c.description ?? ''}
                placeholder="Présentation affichée dans la Distribution…"
                onChange={(e) => patchChar(c.id, { description: e.target.value })}
              />
            </label>
            {c.aliases.length > 0 && (
              <div className="aliases" title="Orthographes reconnues dans le texte">
                {c.aliases.map((a) => (
                  <span className="alias-chip" key={a}>
                    {a}
                  </span>
                ))}
              </div>
            )}
            <label className="edit-row">
              <span>Fusionner dans</span>
              <select value="" onChange={(e) => e.target.value && mergeInto(c.id, e.target.value)}>
                <option value="">— choisir —</option>
                {characters
                  .filter((o) => o.id !== c.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.canonicalName}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
      </li>
    );
  };

  // L'index de palette suit la position d'origine : deux personnages voisins
  // dans la liste filtrée ne doivent pas hériter de la même teinte par hasard.
  const indexOf = (c: Character) => characters.findIndex((o) => o.id === c.id);

  return (
    <section className="panel cast-panel">
      <div className="cast-head">
        <TextField
          type="search"
          value={filter}
          placeholder="Filtrer…"
          aria-label="Filtrer les personnages"
          onChange={setFilter}
        />
        {/* Placé en tête, et non au pied de la liste : c'est une action sur
            l'ensemble, elle ne doit pas se trouver douze lignes plus bas. */}
        <button type="button" onClick={autoAssign} disabled={!voices?.length}>
          Attribuer automatiquement
        </button>
      </div>
      {/* Une seule ligne, et courte : trois lignes d'explication en tête de
          panneau coûtaient à elles seules la moitié d'un personnage. Le sens de
          « moi » est porté par le `title` de la case, là où on la coche. */}
      <p className="hint">
        {voices
          ? `${characters.length} personnages · ${assigned} avec une voix`
          : `${characters.length} personnages`}
      </p>
      {!voices && (
        <p className="hint">
          Synthèse vocale désactivée. Définis <code>ELEVENLABS_API_KEY</code> (voir le README) puis
          relance le serveur pour attribuer des voix.
        </p>
      )}
      {error && <p className="hint error">{error}</p>}

      <ul className="char-list">{active.map((c) => renderItem(c, indexOf(c)))}</ul>

      {others.length > 0 && (
        <>
          <button
            type="button"
            className="cast-more"
            aria-expanded={othersOpen}
            onClick={() => setShowOthers((v) => !v)}
          >
            <Icon name={othersOpen ? 'chevron-down' : 'chevron-right'} size={13} />
            <span>Autres personnages ({others.length})</span>
          </button>
          {othersOpen && (
            <ul className="char-list">{others.map((c) => renderItem(c, indexOf(c)))}</ul>
          )}
        </>
      )}

      {active.length === 0 && others.length === 0 && (
        <p className="hint">Aucun personnage ne correspond à « {filter} ».</p>
      )}
    </section>
  );
}
