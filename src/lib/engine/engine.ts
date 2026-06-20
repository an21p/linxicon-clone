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
}
