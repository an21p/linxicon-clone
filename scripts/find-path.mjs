// Find a chain SRC -> DST per model independently (only that model clearing
// THRESH at each step). Lets us compare how each model routes meaning.
import { readFileSync } from 'node:fs';

const THRESH = 0.41;
const QUANT = 127;
const SRC = process.argv[2] ?? 'bridge';
const DST = process.argv[3] ?? 'diamond';

function load(bin, idx, dim) {
  const index = JSON.parse(readFileSync(idx, 'utf8'));
  const buf = readFileSync(bin);
  const raw = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = index.words.length;
  const m = new Float32Array(n * dim);
  for (let r = 0; r < n; r++) {
    let s = 0;
    for (let i = 0; i < dim; i++) { const v = raw[r * dim + i] / QUANT; m[r * dim + i] = v; s += v * v; }
    s = Math.sqrt(s) || 1;
    for (let i = 0; i < dim; i++) m[r * dim + i] /= s;
  }
  return { words: index.words, m, dim, n, rowOf: new Map(index.words.map((w, i) => [w, i])) };
}

const tables = {
  numberbatch: load('data/numberbatch.bin', 'data/numberbatch-index.json', 300),
  minilm: load('data/minilm.bin', 'data/minilm-index.json', 384),
};

const dot = (t, ra, rb) => {
  const { m, dim } = t; let s = 0; const a = ra * dim, b = rb * dim;
  for (let i = 0; i < dim; i++) s += m[a + i] * m[b + i];
  return s;
};

function neighbors(t, word) {
  const r = t.rowOf.get(word);
  const out = [];
  for (let w = 0; w < t.n; w++) {
    if (w === r) continue;
    const s = dot(t, r, w);
    if (s >= THRESH) out.push(t.words[w]);
  }
  return out;
}

function bfs(t) {
  if (!t.rowOf.has(SRC) || !t.rowOf.has(DST)) return null;
  const prev = new Map([[SRC, null]]);
  const q = [SRC];
  while (q.length) {
    const u = q.shift();
    if (u === DST) break;
    for (const w of neighbors(t, u)) {
      if (!prev.has(w)) { prev.set(w, u); q.push(w); }
    }
  }
  if (!prev.has(DST)) return null;
  const path = [];
  for (let c = DST; c !== null; c = prev.get(c)) path.push(c);
  return path.reverse();
}

for (const name of ['numberbatch', 'minilm']) {
  const t = tables[name];
  const path = bfs(t);
  console.log(`\n=== ${name} (threshold ${THRESH}) ===`);
  if (!path) { console.log('no path found'); continue; }
  console.log('PATH:', path.join(' -> '));
  for (let i = 0; i + 1 < path.length; i++) {
    const s = dot(t, t.rowOf.get(path[i]), t.rowOf.get(path[i + 1]));
    console.log(`  ${path[i]} -> ${path[i + 1]}: ${s.toFixed(3)}`);
  }
  console.log('intermediates:', path.slice(1, -1).join(', '));
}
