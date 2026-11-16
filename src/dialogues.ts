// Messages et fenêtres dans la page, à la place des boîtes natives du navigateur (bloquées dans certains navigateurs embarqués).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Message bref en bas du plan ; `annulable` affiche le bouton « Annuler » (branché par main.ts).
let minuterieMessage = 0;
export function annoncer(texte: string, annulable = false) {
  const m = $('message');
  m.querySelector('span')!.textContent = texte;
  $('b-message-annuler').hidden = !annulable;
  m.hidden = false;
  clearTimeout(minuterieMessage);
  minuterieMessage = window.setTimeout(() => (m.hidden = true), Math.max(5000, texte.length * 70)); // le temps de lire
}

// Fenêtre de saisie ou de confirmation dans la page (les boîtes natives sont bloquées par certains navigateurs embarqués).
const saisie = $<HTMLDialogElement>('saisie');
$('saisie-annuler').onclick = () => saisie.close('');
function ouvrirSaisie(texte: string, valeur: string | null, ok = 'OK'): Promise<string | null> {
  const champ = $<HTMLInputElement>('saisie-champ');
  $('saisie-texte').textContent = texte;
  $('saisie-ok').textContent = ok;
  champ.hidden = valeur === null;
  champ.value = valeur ?? '';
  saisie.returnValue = '';
  saisie.showModal();
  if (valeur !== null) champ.select();
  return new Promise((fin) => saisie.addEventListener('close', () => fin(saisie.returnValue === 'ok' ? champ.value : null), { once: true }));
}
/** Texte saisi, ou null si la fenêtre est annulée. */
export const demanderTexte = (texte: string, valeur = '') => ouvrirSaisie(texte, valeur);
/** Vrai si l'action est confirmée. */
export const demanderAccord = async (texte: string, ok: string) => (await ouvrirSaisie(texte, null, ok)) !== null;
