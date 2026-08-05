/**
 * Ce que la répétition vocale montre à l'écran : où en est la boucle, et ce qui a
 * été dit de travers.
 *
 * Le mode est fait pour s'utiliser sans regarder — c'est le son qui porte le verdict.
 * L'écran vient après coup, pour la seule question à laquelle un son ne répond pas :
 * « qu'est-ce que j'ai raté ? ». D'où le parti pris d'afficher la tirade attendue
 * entière, avec ce qui manque barré et ce qui a été ajouté en surimpression, plutôt
 * qu'une liste d'erreurs qu'il faudrait recoller mentalement au texte.
 */
import { Fragment } from 'react';
import type { Evaluation, VoiceStatus } from '@theatre/audio-player';

/** Ce que dit le bandeau selon l'état de la boucle. `null` = rien à annoncer. */
function label(status: VoiceStatus): string | null {
  switch (status.phase) {
    case 'waiting':
      return 'à toi…';
    case 'listening':
      return "j'écoute";
    case 'validated':
      return 'validé';
    case 'borderline':
      return 'presque';
    case 'failed':
      return status.failures >= 2 ? 'on réécoute' : 'à refaire';
    case 'no-speech':
      return 'rien entendu';
    case 'reference':
      return 'écoute le modèle';
    case 'error':
      return 'micro indisponible';
    default:
      return null;
  }
}

export function VoiceFeedback({ status }: { status: VoiceStatus | null }) {
  if (!status) return null;
  const text = label(status);
  // Hors boucle, le panneau ne disparaît que s'il n'a plus rien à montrer : les
  // écarts d'une validation limite doivent rester lisibles pendant que la scène
  // continue — c'est le seul moment où on peut les regarder sans être attendu.
  if (!text && !status.result) return null;

  return (
    <div className="voice-panel" data-phase={status.phase}>
      <div className="voice-head">
        {/* `role="status"` : l'état change à chaque étape de la boucle et c'est
            précisément ce qu'un lecteur d'écran doit annoncer. */}
        {text && (
          <span className="voice-state" role="status">
            {text}
          </span>
        )}
        {status.heard && <span className="voice-heard">{status.heard}</span>}
      </div>
      {status.message && <p className="voice-message">{status.message}</p>}
      {status.result && (status.phase === 'failed' || status.phase === 'borderline' || status.phase === 'idle') && (
        <Diff result={status.result} />
      )}
    </div>
  );
}

function Diff({ result }: { result: Evaluation }) {
  // Les ajouts sont rattachés au mot attendu qui les précède (-1 = avant le premier) :
  // les replacer là où ils ont été prononcés est ce qui rend l'écart lisible.
  const addedAt = new Map<number, string[]>();
  for (const a of result.added) {
    const at = addedAt.get(a.after) ?? [];
    at.push(a.text);
    addedAt.set(a.after, at);
  }
  // Les espaces sont de vrais espaces et non une marge CSS : sans eux, le texte se
  // copie et surtout se LIT à voix haute d'un seul tenant — « Noncommenttupeux ».
  const insertions = (i: number) =>
    (addedAt.get(i) ?? []).map((t, k) => (
      <Fragment key={`add-${i}-${k}`}>
        <span className="voice-word voice-word--added">{t}</span>{' '}
      </Fragment>
    ));

  return (
    <p className="voice-diff">
      {insertions(-1)}
      {result.words.map((w, i) => (
        <Fragment key={i}>
          <span className={`voice-word voice-word--${w.status}`}>{w.text}</span>{' '}
          {w.status === 'replaced' && w.heard && (
            <>
              <span className="voice-word voice-word--added">{w.heard}</span>{' '}
            </>
          )}
          {insertions(i)}
        </Fragment>
      ))}
    </p>
  );
}
