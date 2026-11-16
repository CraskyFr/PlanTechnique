// Sauvegarde en ligne (côté navigateur) : parle à la fonction /api/plans, qui n'existe que sur le site déployé.
// Le mot de passe est choisi par l'utilisateur dans Vercel ; ce navigateur le retient après la première saisie.
const CLE = 'plan-technique-mdp';

export type PlanEnLigne = { nom: string; date: number; octets: number };
/** Erreur dont `status` vaut 401 quand le mot de passe est refusé. */
export class ErreurEnLigne extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const motDePasseRetenu = () => {
  try {
    return localStorage.getItem(CLE);
  } catch {
    return null;
  }
};
export function retenirMotDePasse(mdp: string | null) {
  try {
    if (mdp) localStorage.setItem(CLE, mdp);
    else localStorage.removeItem(CLE);
  } catch {
    // stockage indisponible : le mot de passe sera redemandé
  }
}

async function appel<T>(methode: 'GET' | 'POST' | 'DELETE', mdp: string, nom?: string): Promise<T> {
  const r = await fetch(`/api/plans${nom === undefined ? '' : `?nom=${encodeURIComponent(nom)}`}`, { method: methode, headers: { authorization: `Bearer ${encodeURIComponent(mdp)}` } });
  // En local (npm run dev), /api n'existe pas : Vite renvoie la page de l'appli à la place.
  if (!r.headers.get('content-type')?.includes('json')) throw new ErreurEnLigne('La sauvegarde en ligne ne fonctionne que sur le site déployé.', r.status);
  const corps = await r.json();
  if (!r.ok) throw new ErreurEnLigne(corps.erreur ?? `Erreur ${r.status}`, r.status);
  return corps;
}

export const listerPlans = async (mdp: string) => (await appel<{ plans: PlanEnLigne[] }>('GET', mdp)).plans;
export const supprimerPlan = (mdp: string, nom: string) => appel<unknown>('DELETE', mdp, nom);

export async function enregistrerPlan(mdp: string, nom: string, texte: string) {
  const { url } = await appel<{ url: string }>('POST', mdp, nom);
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: texte });
  if (!r.ok) throw new ErreurEnLigne(`Envoi refusé par le stockage (${r.status}).`, r.status === 401 ? 500 : r.status);
}

export async function lirePlan(mdp: string, nom: string): Promise<string> {
  const { url } = await appel<{ url: string }>('GET', mdp, nom);
  const r = await fetch(url);
  if (!r.ok) throw new ErreurEnLigne(r.status === 404 ? `Plan « ${nom} » introuvable en ligne.` : `Lecture refusée par le stockage (${r.status}).`, r.status === 401 ? 500 : r.status);
  return r.text();
}
