// Dessin d'une élévation (un mur de pièce vu de face) sur un canevas A4 paysage, pour l'écran et le PDF.
// Les distances et hauteurs sont écrites en clair : le PDF est ajusté à la page, pas à une échelle ronde.

export type ElementDessin = { abscisse: number; hauteur: number | null; nom: string; repere?: string; couleur: string; d: string; texte?: string };
export type OuvertureDessin = { debut: number; fin: number; type: string; nom: string };

const L = 2000, H = 1414; // A4 paysage, ~170 dpi
// Hauteurs types (pas de donnée sur le plan) : affichées comme telles sur la page.
const OUVERTURE: Record<string, [number, number]> = { porte: [0, 2.04], passage: [0, 2.04], fenetre: [0.95, 2.15] };
const virgule = (v: number, n = 2) => v.toFixed(n).replace('.', ',');

/** `longueur` et `hsp` en mètres ; abscisses depuis l'angle gauche, hauteurs depuis le sol fini. */
export function dessinerElevation(titre: string, sousTitre: string, longueur: number, hsp: number, elements: ElementDessin[], ouvertures: OuvertureDessin[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = L;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, L, H);

  const x0 = 170, haut = 230;
  // Étiquettes sous le sol, en rangées décalées quand elles se chevauchent. Un mur chargé (plan de travail)
  // demande plus de rangées : on réduit alors la hauteur du dessin pour qu'elles tiennent au-dessus du pied de page.
  // Étiquette : « distance · hauteur » en gras, puis le nom et le circuit. La hauteur n'est pas écrite à côté du
  // symbole : sur un mur chargé, le symbole voisin la cacherait.
  const lignesDe = (el: ElementDessin) => [`${virgule(el.abscisse)} m · h ${el.hauteur === null ? '?' : Math.round(el.hauteur * 100)}`, el.nom, ...(el.repere ? [el.repere] : [])];
  const largeurs = elements.map((el) =>
    Math.max(...lignesDe(el).map((t, i) => ((g.font = i === 0 ? 'bold 22px system-ui, sans-serif' : '19px system-ui, sans-serif'), g.measureText(t).width))) + 16,
  );
  let k = 0, rangs: number[] = [];
  for (let n = 3; n <= 10; n++) {
    k = Math.min((L - x0 - 90) / longueur, (H - haut - 130 - 50 - n * 86) / hsp); // pixels par mètre
    const fins: number[] = [];
    rangs = elements.map((el, i) => {
      const x = x0 + el.abscisse * k;
      let r = 0;
      while (fins[r] !== undefined && x - largeurs[i] / 2 < fins[r]) r++;
      fins[r] = x + largeurs[i] / 2;
      return r;
    });
    if (Math.max(-1, ...rangs) < n) break;
  }
  const sol = haut + hsp * k, X = (m: number) => x0 + m * k, Y = (m: number) => sol - m * k;

  g.fillStyle = '#111827';
  g.font = 'bold 40px system-ui, sans-serif';
  g.fillText(titre, 60, 80);
  g.font = '24px system-ui, sans-serif';
  g.fillStyle = '#4b5563';
  g.fillText(sousTitre, 60, 120);

  // Mur : face vue depuis la pièce, du sol au plafond.
  g.fillStyle = '#f9fafb';
  g.fillRect(X(0), Y(hsp), longueur * k, hsp * k);
  g.strokeStyle = '#9ca3af';
  g.lineWidth = 2;
  g.setLineDash([12, 8]);
  g.strokeRect(X(0), Y(hsp), longueur * k, hsp * k);
  g.setLineDash([]);
  g.strokeStyle = '#374151';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(X(0) - 30, sol);
  g.lineTo(X(longueur) + 30, sol);
  g.stroke();

  // Règle des hauteurs à gauche, tous les 50 cm.
  g.font = '20px system-ui, sans-serif';
  g.fillStyle = '#6b7280';
  g.strokeStyle = '#9ca3af';
  g.lineWidth = 2;
  for (let h = 0; h <= hsp + 1e-9; h += 0.5) {
    g.beginPath();
    g.moveTo(X(0) - 18, Y(h));
    g.lineTo(X(0), Y(h));
    g.stroke();
    const t = `${Math.round(h * 100)}`;
    g.fillText(t, X(0) - 26 - g.measureText(t).width, Y(h) + 7);
  }
  g.fillText('cm', X(0) - 60, Y(hsp) - 16);

  // Portes et fenêtres, à leurs hauteurs types.
  for (const o of ouvertures) {
    const [b, h] = OUVERTURE[o.type] ?? [0, 2.04];
    const [bas, hautO] = [Math.min(b, hsp), Math.min(h, hsp)];
    g.fillStyle = o.type === 'fenetre' ? '#e0f2fe' : '#fff';
    g.fillRect(X(o.debut), Y(hautO), (o.fin - o.debut) * k, (hautO - bas) * k);
    g.strokeStyle = '#374151';
    g.lineWidth = 3;
    if (o.type === 'passage') g.setLineDash([10, 8]);
    g.strokeRect(X(o.debut), Y(hautO), (o.fin - o.debut) * k, (hautO - bas) * k);
    g.setLineDash([]);
    g.fillStyle = '#374151';
    g.font = '20px system-ui, sans-serif';
    const t = `${o.nom} ${Math.round((o.fin - o.debut) * 100)} cm`;
    g.fillText(t, X((o.debut + o.fin) / 2) - g.measureText(t).width / 2, Y(hautO) - 10);
  }

  // Équipements : symbole à sa hauteur, trait de rappel jusqu'au sol, étiquettes sous le sol en rangées décalées.
  const taille = 56;
  for (const [i, el] of elements.entries()) {
    const inconnue = el.hauteur === null, h = inconnue ? Math.min(1, hsp / 2) : el.hauteur!;
    const [x, y] = [X(el.abscisse), Y(Math.min(h, hsp))];
    g.strokeStyle = '#9ca3af';
    g.lineWidth = 1.5;
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(x, y + taille / 2);
    g.lineTo(x, sol + 20);
    g.stroke();
    g.setLineDash([]);
    g.save();
    g.translate(x - taille / 2, y - taille / 2);
    g.scale(taille / 24, taille / 24);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 24, 24);
    g.strokeStyle = el.couleur;
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke(new Path2D(el.d));
    if (el.texte) {
      g.fillStyle = el.couleur;
      g.font = 'bold 7px system-ui, sans-serif';
      g.fillText(el.texte, 12 - g.measureText(el.texte).width / 2, 14.5);
    }
    g.restore();

    const lignes = lignesDe(el);
    const r = rangs[i], yt = sol + 50 + r * 86;
    if (r) {
      g.strokeStyle = '#d1d5db';
      g.beginPath();
      g.moveTo(x, sol + 20);
      g.lineTo(x, yt - 22);
      g.stroke();
    }
    lignes.forEach((t, i) => {
      g.font = i === 0 ? 'bold 22px system-ui, sans-serif' : '19px system-ui, sans-serif';
      g.fillStyle = i === 0 ? (inconnue ? '#ea580c' : '#111827') : el.couleur;
      g.fillText(t, x - g.measureText(t).width / 2, yt + i * 24);
    });
  }

  // Longueur du mur, d'angle à angle.
  g.strokeStyle = '#cc2aa6';
  g.fillStyle = '#cc2aa6';
  g.lineWidth = 2;
  const yc = haut - 40;
  g.beginPath();
  g.moveTo(X(0), yc);
  g.lineTo(X(longueur), yc);
  for (const xx of [X(0), X(longueur)]) (g.moveTo(xx, yc - 12), g.lineTo(xx, yc + 12));
  g.stroke();
  g.font = 'bold 24px system-ui, sans-serif';
  const t = `${virgule(longueur)} m`;
  g.fillText(t, X(longueur / 2) - g.measureText(t).width / 2, yc - 12);

  g.font = '19px system-ui, sans-serif';
  g.fillStyle = '#6b7280';
  g.fillText("Distances depuis l'angle gauche du mur, vu depuis la pièce ; hauteurs à l'axe du boîtier depuis le sol fini, en cm.", 60, H - 70);
  g.fillText('Portes et fenêtres : hauteurs types, à vérifier sur place. En orange : hauteur non renseignée dans Propriétés.', 60, H - 42);
  return c;
}
