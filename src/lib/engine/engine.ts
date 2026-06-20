import { cosineSimilarity, type Vec } from '../math';
import type { WordNode, Edge, WordSeed } from './types';

export const DEFAULT_THRESHOLD = 0.41;

export class GameEngine {
  readonly threshold: number;
  readonly targetA: string;
  readonly targetB: string;
  private nodes = new Map<string, WordNode>();
  private edges: Edge[] = [];

  constructor(a: WordSeed, b: WordSeed, threshold: number = DEFAULT_THRESHOLD) {
    this.threshold = threshold;
    this.targetA = a.word;
    this.targetB = b.word;
    this.insert(a.word, a.vector, true);
    this.insert(b.word, b.vector, true);
  }

  private insert(word: string, vector: Vec, isTarget: boolean): WordNode {
    if (this.nodes.has(word)) {
      throw new Error(`"${word}" is already on the board`);
    }
    const node: WordNode = { id: word, vector, isTarget };
    for (const existing of this.nodes.values()) {
      const sim = cosineSimilarity(vector, existing.vector);
      if (sim >= this.threshold) {
        this.edges.push({ a: word, b: existing.id, sim });
      }
    }
    this.nodes.set(word, node);
    return node;
  }

  addWord(word: string, vector: Vec): WordNode {
    return this.insert(word, vector, false);
  }

  getEdges(): Edge[] {
    return this.edges.map((e) => ({ ...e }));
  }

  getNodes(): WordNode[] {
    return [...this.nodes.values()].map((n) => ({ ...n }));
  }

  has(word: string): boolean {
    return this.nodes.has(word);
  }

  /** Maximum-bottleneck similarity along the best path between the two targets. */
  closestGap(): number {
    const ids = [...this.nodes.keys()];
    const best = new Map<string, number>();
    for (const id of ids) best.set(id, -Infinity);
    best.set(this.targetA, Infinity);
    const visited = new Set<string>();

    while (visited.size < ids.length) {
      let u: string | null = null;
      let bu = -Infinity;
      for (const id of ids) {
        const v = best.get(id)!;
        if (!visited.has(id) && v > bu) { bu = v; u = id; }
      }
      if (u === null) break;
      visited.add(u);
      if (u === this.targetB) break;

      const uVec = this.nodes.get(u)!.vector;
      for (const v of ids) {
        if (visited.has(v)) continue;
        const w = cosineSimilarity(uVec, this.nodes.get(v)!.vector);
        const cand = Math.min(best.get(u)!, w);
        if (cand > best.get(v)!) best.set(v, cand);
      }
    }
    const gap = best.get(this.targetB)!;
    return gap === Infinity ? 1 : gap;
  }

  isSolved(): boolean {
    return this.closestGap() >= this.threshold;
  }
}
