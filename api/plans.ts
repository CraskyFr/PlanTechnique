// Sauvegarde en ligne des plans (fonction Vercel), pour un usage personnel protégé par un mot de passe.
// Les plans sont des fichiers plans/<nom>.json dans un magasin Vercel Blob privé. Le JSON ne transite pas
// par cette fonction (limite de 4,5 Mo par requête) : elle délivre une adresse signée, valable 5 minutes,
// que le navigateur utilise pour envoyer ou lire le fichier directement.
import { createHash, timingSafeEqual } from 'node:crypto';
import { del, issueSignedToken, list, presignUrl } from '@vercel/blob';

const DOSSIER = 'plans/';
const TAILLE_MAX = 100 * 1024 * 1024; // 100 Mo par plan
const erreur = (status: number, message: string) => Response.json({ erreur: message }, { status });

// ponytail: pas de limitation du nombre d'essais ; choisir un mot de passe long, ou ajouter un compteur si le site est attaqué.
function refus(request: Request): Response | null {
  const attendu = process.env.MOT_DE_PASSE;
  if (!attendu) return erreur(503, 'Mot de passe non configuré sur le serveur (variable MOT_DE_PASSE dans Vercel).');
  let recu = '';
  try {
    recu = decodeURIComponent(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
  } catch {
    // en-tête mal formé : traité comme un mot de passe faux
  }
  const empreinte = (s: string) => createHash('sha256').update(s).digest(); // même longueur pour la comparaison
  return timingSafeEqual(empreinte(recu), empreinte(attendu)) ? null : erreur(401, 'Mot de passe incorrect.');
}

/** Chemin du plan nommé dans l'adresse (?nom=…), ou null si le nom est absent ou invalide. */
function chemin(request: Request): string | null {
  const nom = new URL(request.url).searchParams.get('nom')?.trim() ?? '';
  return /^[\p{L}\p{N} _-]{1,60}$/u.test(nom) ? `${DOSSIER}${nom}.json` : null;
}

async function adresseSignee(pathname: string, operation: 'get' | 'put'): Promise<string> {
  const validUntil = Date.now() + 5 * 60 * 1000;
  const jeton = await issueSignedToken({ pathname, operations: [operation], validUntil });
  const { presignedUrl } = await presignUrl(
    jeton,
    operation === 'get'
      ? { access: 'private', operation, pathname, useCache: false } // toujours la dernière version enregistrée
      : { access: 'private', operation, pathname, allowOverwrite: true, addRandomSuffix: false, maximumSizeInBytes: TAILLE_MAX },
  );
  return presignedUrl;
}

async function traiter(request: Request, action: (pathname: string | null) => Promise<Response>): Promise<Response> {
  const non = refus(request);
  if (non) return non;
  try {
    return await action(chemin(request));
  } catch (err) {
    console.error(err);
    return erreur(500, `Stockage en ligne indisponible : ${(err as Error).message}`);
  }
}
const NOM_INVALIDE = 'Nom de plan invalide : lettres, chiffres, espaces, tirets, 60 caractères au plus.';

// GET /api/plans → liste des plans ; GET /api/plans?nom=X → adresse de lecture du plan X.
export const GET = (request: Request) =>
  traiter(request, async (pathname) => {
    if (new URL(request.url).searchParams.has('nom')) return pathname ? Response.json({ url: await adresseSignee(pathname, 'get') }) : erreur(400, NOM_INVALIDE);
    const { blobs } = await list({ prefix: DOSSIER, limit: 1000 });
    const plans = blobs
      .filter((b) => b.pathname.endsWith('.json'))
      .map((b) => ({ nom: b.pathname.slice(DOSSIER.length, -'.json'.length), date: new Date(b.uploadedAt).getTime(), octets: b.size }))
      .sort((a, b) => b.date - a.date);
    return Response.json({ plans });
  });

// POST /api/plans?nom=X → adresse d'envoi du plan X (remplace l'ancien).
export const POST = (request: Request) => traiter(request, async (pathname) => (pathname ? Response.json({ url: await adresseSignee(pathname, 'put') }) : erreur(400, NOM_INVALIDE)));

// DELETE /api/plans?nom=X → supprime le plan X.
export const DELETE = (request: Request) =>
  traiter(request, async (pathname) => {
    if (!pathname) return erreur(400, NOM_INVALIDE);
    await del(pathname);
    return Response.json({ ok: true });
  });
