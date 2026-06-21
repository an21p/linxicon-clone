// Offline MiniLM table generation. Run: node scripts/build-minilm.mjs
// Emits data/minilm.bin (int8 N x 384) + data/minilm-index.json.
// QUANT_SCALE must match server/vectorTable.ts and scripts/build-vectors.py (127).
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUANT_SCALE = 127;
const DIM = 384;

env.allowLocalModels = false;

const words = JSON.parse(readFileSync(join(ROOT, 'src/lib/words/dictionary.json'), 'utf8'));
const n = words.length;
console.log(`embedding ${n} words with all-MiniLM-L6-v2 (this takes several minutes)…`);

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const mat = new Int8Array(n * DIM);

for (let i = 0; i < n; i++) {
  const out = await extractor(words[i], { pooling: 'mean', normalize: true });
  const v = out.data; // Float32Array length 384 (already normalized)
  let norm = 0;
  for (let k = 0; k < DIM; k++) norm += v[k] * v[k];
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < DIM; k++) {
    let q = Math.round((v[k] / norm) * QUANT_SCALE);
    if (q > QUANT_SCALE) q = QUANT_SCALE;
    if (q < -QUANT_SCALE) q = -QUANT_SCALE;
    mat[i * DIM + k] = q;
  }
  if (i % 2000 === 0) console.log(`  ${i}/${n}`);
}

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data/minilm.bin'), Buffer.from(mat.buffer));
writeFileSync(join(ROOT, 'data/minilm-index.json'), JSON.stringify({ dim: DIM, words }));
console.log(`vocab ${n} · minilm.bin ${statSync(join(ROOT, 'data/minilm.bin')).size} bytes`);
