// PDF d'une page contenant une image JPEG, sans dépendance : le format PDF lit le JPEG tel quel (filtre DCTDecode).

const MM = 72 / 25.4; // points par millimètre

/** Page A4 (paysage si l'image est plus large que haute), image centrée et ajustée dans 10 mm de marge. */
export function pdfDepuisJpeg(jpeg: Uint8Array, largeur: number, hauteur: number): Uint8Array<ArrayBuffer> {
  const [pw, ph] = largeur > hauteur ? [297 * MM, 210 * MM] : [210 * MM, 297 * MM];
  const k = Math.min((pw - 20 * MM) / largeur, (ph - 20 * MM) / hauteur);
  const [w, h] = [largeur * k, hauteur * k];
  const n = (v: number) => v.toFixed(2);
  const dessin = `q ${n(w)} 0 0 ${n(h)} ${n((pw - w) / 2)} ${n((ph - h) / 2)} cm /Im0 Do Q`;

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
  objet('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objet(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pw)} ${n(ph)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  objet(`<< /Type /XObject /Subtype /Image /Width ${largeur} /Height ${hauteur} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  objet(`<< /Length ${dessin.length} >>`, new TextEncoder().encode(dessin));
  const xref = taille;
  ecrire(`xref\n0 ${decalages.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}`);
  ecrire(`trailer\n<< /Size ${decalages.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const pdf = new Uint8Array(taille);
  let i = 0;
  for (const m of morceaux) (pdf.set(m, i), (i += m.length));
  return pdf;
}
