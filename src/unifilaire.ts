// Schéma unifilaire du tableau proposé, en PDF A4 paysage (dessiné sur un canevas, puis embarqué en JPEG).
import { protection, tableau } from './calculs.ts';
import { pdfDepuisJpeg } from './pdf.ts';
import type { Circuit } from './etat.ts';

const PAS = 190; // largeur d'une colonne de circuit, en pixels du schéma

/** PDF du schéma pour ces circuits nommés ; `surface` du logement en m², `titre` = nom de l'étage. */
export async function pdfUnifilaire(circuits: Circuit[], surface: number, titre: string): Promise<Blob | null> {
  const diffs = tableau(circuits, surface);
  const parNom = new Map(circuits.map((c) => [c.nom, c]));
  const colonnes = diffs.reduce((s, d) => s + Math.max(1, d.circuits.length), 0);
  const L = Math.max(2000, 260 + colonnes * PAS), H = Math.round(L / 1.414);
  const c = document.createElement('canvas');
  c.width = L;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, L, H);
  g.strokeStyle = g.fillStyle = '#111827';
  g.lineWidth = 3;
  g.font = 'bold 34px system-ui, sans-serif';
  g.fillText(`Schéma unifilaire proposé — ${titre}`, 60, 70);
  g.font = '22px system-ui, sans-serif';
  g.fillText('Règles simplifiées NF C 15-100 : à faire valider par un électricien.', 60, 105);
  const boite = (x: number, y: number, w: number, h: number, lignes: string[]) => {
    g.strokeRect(x - w / 2, y, w, h);
    lignes.forEach((t, i) => g.fillText(t, x - g.measureText(t).width / 2, y + 30 + i * 26));
  };
  // Arrivée : disjoncteur de branchement, puis barre de distribution.
  const yBarre = 330;
  g.font = 'bold 22px system-ui, sans-serif';
  boite(130, 150, 180, 70, ['Disjoncteur', 'de branchement']);
  g.beginPath();
  g.moveTo(130, 220);
  g.lineTo(130, yBarre);
  g.lineTo(L - 60, yBarre);
  g.stroke();
  let x = 260;
  for (const d of diffs) {
    const n = Math.max(1, d.circuits.length), largeur = n * PAS, cx = x + largeur / 2 - PAS / 2;
    g.beginPath();
    g.moveTo(cx, yBarre);
    g.lineTo(cx, yBarre + 40);
    g.stroke();
    g.font = 'bold 20px system-ui, sans-serif';
    boite(cx, yBarre + 40, Math.min(largeur - 20, 280), 80, [`Différentiel ${d.calibre} A`, `30 mA · type ${d.type}`]);
    const yBus = yBarre + 160;
    g.beginPath();
    g.moveTo(cx, yBarre + 120);
    g.lineTo(cx, yBus);
    g.moveTo(x, yBus);
    g.lineTo(x + (n - 1) * PAS, yBus);
    g.stroke();
    d.circuits.forEach((nom, i) => {
      const cxi = x + i * PAS, circ = parNom.get(nom)!, p = protection(circ);
      g.beginPath();
      g.moveTo(cxi, yBus);
      g.lineTo(cxi, yBus + 40);
      g.stroke();
      g.font = 'bold 20px system-ui, sans-serif';
      boite(cxi, yBus + 40, 120, 60, [`${p.calibre} A`]);
      g.beginPath();
      g.moveTo(cxi, yBus + 100);
      g.lineTo(cxi, yBus + 200);
      g.stroke();
      g.font = 'bold 22px system-ui, sans-serif';
      g.fillText(nom, cxi - g.measureText(nom).width / 2, yBus + 230);
      g.font = '18px system-ui, sans-serif';
      const contenu = [circ.prises && `${circ.prises} PC`, circ.eclairage && `${circ.eclairage} éclair.`, circ.dedies && 'spécialisé', circ.autres && `${circ.autres} autres`].filter(Boolean) as string[];
      [p.section, ...contenu].forEach((t, j) => g.fillText(t, cxi - g.measureText(t).width / 2, yBus + 258 + j * 24));
    });
    x += largeur;
  }
  const jpeg = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
  if (!jpeg) return null;
  return new Blob([pdfDepuisJpeg(new Uint8Array(await jpeg.arrayBuffer()), L, H)], { type: 'application/pdf' });
}
