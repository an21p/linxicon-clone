import type { Vec } from '../math';

export interface WordNode {
  id: string;       // normalized word
  vector: Vec;
  isTarget: boolean;
}

export interface Edge {
  a: string;        // word id
  b: string;        // word id
  sim: number;      // cosine similarity (>= threshold)
}

export interface WordSeed {
  word: string;
  vector: Vec;
}
