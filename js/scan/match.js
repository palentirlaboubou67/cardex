// Recherche exhaustive dans data/scan/hashes.bin (64 octets = 16 mots de 32 bits par carte) par XOR + popcount.
// Distance d = bits différents / 128 (≈ 2 pour deux cartes sans rapport, ≈ 0,5–0,9 pour la bonne carte).
import { POP16 } from './describe.js';

const P = POP16;

export class ScanDB {
  constructor(buf, cards) {
    this.h = new Uint32Array(buf);
    this.n = (this.h.length / 16) | 0;
    this.ids = cards.ids;
    if (this.ids.length !== this.n) throw new Error(`base du scanner incohérente (${this.ids.length} ids, ${this.n} lignes)`);
    this.row = new Map(this.ids.map((id, i) => [id, i]));
    this.src = cards.src || '';
    this.sets = cards.sets || {};
    this.codes = cards.codes || {};
    this.img = cards.img || {};
    this.noimg = cards.noimg || [];
    // groupes de réimpressions (même illustration)
    this.group = new Int32Array(this.n).fill(-1);
    this.groups = [];
    for (const g of cards.dups || []) {
      const rows = g.map(id => this.row.get(id)).filter(i => i !== undefined);
      if (rows.length < 2) continue;
      for (const i of rows) this.group[i] = this.groups.length;
      this.groups.push(rows);
    }
    // sosies (cartes différentes mais très proches à l'image)
    this.near = new Map();
    for (const [a, b] of cards.near || []) {
      const i = this.row.get(a), j = this.row.get(b);
      if (i === undefined || j === undefined) continue;
      (this.near.get(i) || this.near.set(i, []).get(i)).push(j);
      (this.near.get(j) || this.near.set(j, []).get(j)).push(i);
    }
    // jumelles sans image (cards.json twins : carte avec image → cartes de même illustration sans image dans la base,
    // kits du dresseur, McDonald's, promos…) : une telle ligne n'est jamais acceptée sur l'image seule
    this.twins = cards.twins || {};
    this.mask = null;   // Uint8Array : lignes ignorées (banc d'essai « carte absente »)
  }

  // Jumelles sans image de la carte i et de ses réimpressions
  twinsOf(i) {
    const out = [];
    for (const j of this.members(i)) for (const t of this.twins[this.ids[j]] || []) if (!out.includes(t)) out.push(t);
    return out;
  }

  // Masque une carte et son groupe de réimpressions (banc d'essai).
  exclude(ids) {
    this.mask = null;
    if (!ids || !ids.length) return;
    this.mask = new Uint8Array(this.n);
    for (const id of ids) {
      const i = this.row.get(id);
      if (i === undefined) continue;
      for (const j of this.members(i)) this.mask[j] = 1;
    }
  }

  members(i) { return this.group[i] < 0 ? [i] : this.groups[this.group[i]]; }

  // Les k meilleures lignes [{ i, s }] (s = bits différents), triées.
  top(q, k = 12) {
    const qw = new Uint32Array(q.buffer, q.byteOffset, 16), h = this.h, n = this.n, mask = this.mask;
    const q0 = qw[0], q1 = qw[1], q2 = qw[2], q3 = qw[3], q4 = qw[4], q5 = qw[5], q6 = qw[6], q7 = qw[7];
    const q8 = qw[8], q9 = qw[9], q10 = qw[10], q11 = qw[11], q12 = qw[12], q13 = qw[13], q14 = qw[14], q15 = qw[15];
    const bs = new Int32Array(k).fill(1 << 30), bi = new Int32Array(k).fill(-1);
    let worst = 1 << 30;
    for (let i = 0, o = 0; i < n; i++, o += 16) {
      let x = h[o] ^ q0, s = P[x & 0xffff] + P[x >>> 16];
      x = h[o + 1] ^ q1; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 2] ^ q2; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 3] ^ q3; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 4] ^ q4; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 5] ^ q5; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 6] ^ q6; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 7] ^ q7; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 8] ^ q8; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 9] ^ q9; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 10] ^ q10; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 11] ^ q11; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 12] ^ q12; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 13] ^ q13; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 14] ^ q14; s += P[x & 0xffff] + P[x >>> 16];
      x = h[o + 15] ^ q15; s += P[x & 0xffff] + P[x >>> 16];
      if (s >= worst || (mask && mask[i])) continue;
      let j = k - 1;
      while (j > 0 && bs[j - 1] > s) { bs[j] = bs[j - 1]; bi[j] = bi[j - 1]; j--; }
      bs[j] = s; bi[j] = i;
      worst = bs[k - 1];
    }
    const out = [];
    for (let j = 0; j < k && bi[j] >= 0; j++) out.push({ i: bi[j], s: bs[j] });
    return out;
  }

  // Meilleure distance (en bits) : objectif du détecteur.
  best(q) {
    const t = this.top(q, 1);
    return t.length ? t[0] : { i: -1, s: 1 << 30 };
  }

  // Bits différents avec une ligne donnée.
  bits(q, i) {
    const qw = new Uint32Array(q.buffer, q.byteOffset, 16), h = this.h, o = i * 16;
    let s = 0;
    for (let j = 0; j < 16; j++) { const x = h[o + j] ^ qw[j]; s += P[x & 0xffff] + P[x >>> 16]; }
    return s;
  }

  // Classement complet : top 5 (ids + distances), d1 ; membres du groupe de réimpressions de la première carte ;
  // « rivals » = ses sosies connus (cards.json near) proches de la requête (d < d1 + lookalike, 6 au plus), que la
  // zone du numéro départagera ; d2 = meilleure distance hors du groupe et de ces rivaux (marge exigée sur le reste).
  rank(q, k = 5, { lookalike = 0.45, maxRivals = 6 } = {}) {
    const t = this.top(q, 12);
    if (!t.length) return null;
    const mask = this.mask, keep = j => !mask || !mask[j];
    const i1 = t[0].i, grp = this.members(i1).filter(keep);
    const d1 = t[0].s / 128;
    const near = (this.near.get(i1) || []).filter(keep).map(j => ({ i: j, d: this.bits(q, j) / 128 })).sort((a, b) => a.d - b.d);
    const rivals = near.filter(x => x.d < d1 + lookalike).slice(0, maxRivals);
    const excl = new Set([...grp, ...rivals.map(x => x.i)]);
    let out2 = t.find(x => !excl.has(x.i));
    if (!out2) out2 = this.top(q, 48).find(x => !excl.has(x.i));
    const d2 = out2 ? out2.s / 128 : 4;
    const group = grp.map(j => ({ i: j, d: this.bits(q, j) / 128 })).sort((a, b) => a.d - b.d);
    return {
      top: t.slice(0, k).map(x => ({ id: this.ids[x.i], i: x.i, d: x.s / 128 })),
      d1, d2, i1, group, near, rivals,
    };
  }

  // Adresse de l'image TCGdex (sans suffixe) d'une ligne : FR si src = 'f', sinon EN.
  imageBase(i) {
    const id = this.ids[i];
    const lang = this.src[i] === 'e' ? 'en' : 'fr';
    if (this.img[id]) return 'https://assets.tcgdex.net/' + this.img[id];
    const cut = id.lastIndexOf('-'), set = id.slice(0, cut), local = id.slice(cut + 1);
    const s = this.sets[set];
    return s ? `https://assets.tcgdex.net/${lang}/${s.s}/${set}/${local}` : null;
  }

  setOf(i) { const id = this.ids[i]; return this.sets[id.slice(0, id.lastIndexOf('-'))] || null; }
}
