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

  /**
   * Widest-path (max-bottleneck) search from targetA over all words. Returns each
   * node's best bottleneck similarity back to targetA and the predecessor that
   * achieved it, so callers can read the gap or reconstruct the bridging path.
   */
  private widestFromA(): { best: Map<string, number>; prev: Map<string, string | null> } {
    const ids = [...this.nodes.keys()];
    const best = new Map<string, number>();
    const prev = new Map<string, string | null>();
    for (const id of ids) { best.set(id, -Infinity); prev.set(id, null); }
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
        if (cand > best.get(v)!) { best.set(v, cand); prev.set(v, u); }
      }
    }
    return { best, prev };
  }

  /** Maximum-bottleneck similarity along the best path between the two targets. */
  closestGap(): number {
    const gap = this.widestFromA().best.get(this.targetB)!;
    return gap === Infinity ? 1 : gap;
  }

  /**
   * Ordered word ids along the widest path from targetA to targetB (inclusive of
   * both targets). This is the chain the gap metric measures — the bridge to walk
   * when revealing the result.
   */
  bridgePath(): string[] {
    const { best, prev } = this.widestFromA();
    if (best.get(this.targetB) === -Infinity) return [];
    const path: string[] = [];
    const guard = new Set<string>();
    let cur: string | null = this.targetB;
    while (cur !== null && !guard.has(cur)) {
      path.push(cur);
      guard.add(cur);
      cur = prev.get(cur) ?? null;
    }
    return path.reverse();
  }

  /**
   * The weakest consecutive link along the widest bridge path — the gap a hint
   * should target. Returns the two word ids and their similarity, or null if the
   * board is empty of a meaningful path.
   */
  bottleneckLink(): { a: string; b: string; sim: number } | null {
    const path = this.bridgePath();
    if (path.length < 2) return null;
    let weakest: { a: string; b: string; sim: number } | null = null;
    for (let i = 0; i < path.length - 1; i++) {
      const s = cosineSimilarity(this.nodes.get(path[i])!.vector, this.nodes.get(path[i + 1])!.vector);
      if (!weakest || s < weakest.sim) weakest = { a: path[i], b: path[i + 1], sim: s };
    }
    return weakest;
  }

  isSolved(): boolean {
    return this.closestGap() >= this.threshold;
  }

  /** Number of intermediate words placed (excludes the two targets). */
  wordCount(): number {
    return this.nodes.size - 2;
  }
}
