import { readFileSync } from 'node:fs';

// Must match scripts/build-vectors.py and scripts/build-minilm.mjs (127).
export const QUANT_SCALE = 127;

export interface TableIndex {
  dim: number;
  words: string[];
}

export class VectorTable {
  readonly dim: number;
  private readonly matrix: Int8Array;
  private readonly rowOf: Map<string, number>;

  constructor(matrix: Int8Array, words: string[], dim: number) {
    this.dim = dim;
    this.matrix = matrix;
    this.rowOf = new Map(words.map((w, i) => [w, i]));
  }

  static fromFiles(binPath: string, indexPath: string): VectorTable {
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as TableIndex;
    const buf = readFileSync(binPath);
    const matrix = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const expected = index.words.length * index.dim;
    if (matrix.length !== expected) {
      throw new Error(`table size mismatch: ${matrix.length} != ${expected} (${binPath})`);
    }
    return new VectorTable(matrix, index.words, index.dim);
  }

  /** Dequantized (÷127), L2-normalized vector for `word`, or null if absent. */
  lookup(word: string): Float32Array | null {
    const row = this.rowOf.get(word);
    if (row === undefined) return null;
    const dim = this.dim;
    const out = new Float32Array(dim);
    let n = 0;
    for (let i = 0; i < dim; i++) {
      const v = this.matrix[row * dim + i] / QUANT_SCALE;
      out[i] = v;
      n += v * v;
    }
    n = Math.sqrt(n);
    if (n > 0) for (let i = 0; i < dim; i++) out[i] /= n;
    return out;
  }
}
