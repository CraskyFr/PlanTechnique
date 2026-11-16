// Ce que l'appli garde dans le navigateur : la sauvegarde automatique du projet (IndexedDB) et les prix du devis (localStorage).
export type Sauvegarde = { texte: string; date: number; enregistre: boolean };
const ouvrirBase = () =>
  new Promise<IDBDatabase>((ok, ko) => {
    const r = indexedDB.open('plan-technique', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sauvegarde');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
/** Sans argument : lit la sauvegarde ; avec : la remplace. */
export async function sauvegarde(valeur?: Sauvegarde): Promise<Sauvegarde | undefined> {
  const table = (await ouvrirBase()).transaction('sauvegarde', valeur ? 'readwrite' : 'readonly').objectStore('sauvegarde');
  const r = valeur ? table.put(valeur, 'projet') : table.get('projet');
  return new Promise((ok, ko) => ((r.onsuccess = () => ok(valeur ? undefined : r.result)), (r.onerror = () => ko(r.error))));
}

const CLE_PRIX = 'plan-technique-prix';
export function lirePrix(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(CLE_PRIX) ?? '{}');
  } catch {
    return {};
  }
}
export function ecrirePrix(prix: Record<string, number>) {
  try {
    localStorage.setItem(CLE_PRIX, JSON.stringify(prix));
  } catch {
    // stockage indisponible : les prix ne seront pas retrouvés au prochain lancement
  }
}
