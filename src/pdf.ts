// PDF de pages contenant chacune une image JPEG, sans dépendance : le format PDF lit le JPEG tel quel (filtre DCTDecode).

const MM = 72 / 25.4; // points par millimètre
export type PageJpeg = { jpeg: Uint8Array; largeur: number; hauteur: number };

/** Page A4 (paysage si l'image est plus large que haute), image centrée et ajustée dans 10 mm de marge. */
export const pdfDepuisJpeg = (jpeg: Uint8Array, largeur: number, hauteur: number) => pdfDepuisJpegs([{ jpeg, largeur, hauteur }]);

/** Une page A4 par image, chacune orientée et ajustée comme dans `pdfDepuisJpeg`. */
export function pdfDepuisJpegs(pages: PageJpeg[]): Uint8Array<ArrayBuffer> {
  const n = (v: number) => v.toFixed(2);
  const morceaux: Uint8Array[] = [];
  const decalages: number[] = [];
  let taille = 0;
  const ecrire = (x: string | Uint8Array) => {
    const octets = typeof x === 'string' ? new TextEncoder().encode(x) : x; // les parties texte sont en ASCII
    morceaux.push(octets);
    taille += octets.length;
  };
  const objet = (corps: string, flux?: Uint8Array) => {
    decalages.push(taille);
    ecrire(`${decalages.length} 0 obj\n${corps}\n`);
    if (flux) (ecrire('stream\n'), ecrire(flux), ecrire('\nendstream\n'));
    ecrire('endobj\n');
  };

  ecrire('%PDF-1.4\n');
  objet('<< /Type /Catalog /Pages 2 0 R >>');
  // Objets de la page i : 3 + 3i (page), 4 + 3i (image), 5 + 3i (contenu).
  objet(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach(({ jpeg, largeur, hauteur }, i) => {
    const [pw, ph] = largeur > hauteur ? [297 * MM, 210 * MM] : [210 * MM, 297 * MM];
    const k = Math.min((pw - 20 * MM) / largeur, (ph - 20 * MM) / hauteur);
    const [w, h] = [largeur * k, hauteur * k];
    const dessin = `q ${n(w)} 0 0 ${n(h)} ${n((pw - w) / 2)} ${n((ph - h) / 2)} cm /Im0 Do Q`;
    objet(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pw)} ${n(ph)}] /Resources << /XObject << /Im0 ${4 + 3 * i} 0 R >> >> /Contents ${5 + 3 * i} 0 R >>`);
    objet(`<< /Type /XObject /Subtype /Image /Width ${largeur} /Height ${hauteur} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    objet(`<< /Length ${dessin.length} >>`, new TextEncoder().encode(dessin));
  });
  const xref = taille;
  ecrire(`xref\n0 ${decalages.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}`);
  ecrire(`trailer\n<< /Size ${decalages.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const pdf = new Uint8Array(taille);
  let i = 0;
  for (const m of morceaux) (pdf.set(m, i), (i += m.length));
  return pdf;
}
