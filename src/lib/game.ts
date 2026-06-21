import { writable, type Readable } from 'svelte/store';
import { GameEngine, DEFAULT_THRESHOLD } from './engine/engine';
import type { WordNode, Edge } from './engine/types';
import type { Embedder } from './embedder';
import type { ValidationResult } from './dictionary';
import type { Puzzle } from './puzzles';
import { loadStats, saveStats, recordWin, recordSkip, type Stats } from './stats';

export interface GameState {
  targetA: string;
  targetB: string;
  nodes: WordNode[];
  edges: Edge[];
  gap: number;
  solved: boolean;
  wordCount: number;
  lastWord: string | null;
}

export interface SubmitResult {
  ok: boolean;
  reason?: 'malformed' | 'unknown' | 'duplicate';
}

export interface GameDeps {
  embedder: Embedder;
  validateWord: (raw: string) => ValidationResult;
  generatePuzzle: () => Puzzle;
  /** Per-model connect/win threshold; defaults to the engine's DEFAULT_THRESHOLD. */
  threshold?: number;
}

const EMPTY: GameState = {
  targetA: '', targetB: '', nodes: [], edges: [], gap: 0,
  solved: false, wordCount: 0, lastWord: null,
};

export function createGame(deps: GameDeps) {
  const state = writable<GameState>(EMPTY);
  const stats = writable<Stats>(loadStats());
  let engine: GameEngine | null = null;
  let wonThisGame = false;
  let embedder = deps.embedder;
  let threshold = deps.threshold ?? DEFAULT_THRESHOLD;

  function snapshot(lastWord: string | null): GameState {
    const e = engine!;
    return {
      targetA: e.targetA,
      targetB: e.targetB,
      nodes: e.getNodes(),
      edges: e.getEdges(),
      gap: e.closestGap(),
      solved: e.isSolved(),
      wordCount: e.wordCount(),
      lastWord,
    };
  }

  async function newGame(): Promise<void> {
    const p = deps.generatePuzzle();
    const [va, vb] = await Promise.all([embedder.embed(p.a), embedder.embed(p.b)]);
    engine = new GameEngine({ word: p.a, vector: va }, { word: p.b, vector: vb }, threshold);
    wonThisGame = false;
    state.set(snapshot(null));
  }

  async function submitWord(raw: string): Promise<SubmitResult> {
    if (!engine) return { ok: false };
    const v = deps.validateWord(raw);
    if (!v.ok) return { ok: false, reason: v.reason };
    if (engine.has(v.word)) return { ok: false, reason: 'duplicate' };

    const vec = await embedder.embed(v.word);
    engine.addWord(v.word, vec);
    state.set(snapshot(v.word));

    if (engine.isSolved() && !wonThisGame) {
      wonThisGame = true;
      stats.update((s) => {
        const next = recordWin(s, engine!.wordCount());
        saveStats(next);
        return next;
      });
    }
    return { ok: true };
  }

  function skip(): void {
    if (!wonThisGame) {
      stats.update((s) => { const next = recordSkip(s); saveStats(next); return next; });
    }
  }

  function setEmbedder(e: Embedder): void {
    embedder = e;
  }

  /** Set the per-model connect/win threshold; applied on the next (re-)build. */
  function setThreshold(t: number): void {
    threshold = t;
  }

  /**
   * Rebuild the current board at the active threshold using the words' existing
   * vectors — no re-embedding. Cheap enough to drive from a live threshold slider.
   */
  function rescore(): void {
    if (!engine) return;
    const nodes = engine.getNodes();
    const a = nodes.find((n) => n.id === engine!.targetA)!;
    const b = nodes.find((n) => n.id === engine!.targetB)!;
    const next = new GameEngine({ word: a.id, vector: a.vector }, { word: b.id, vector: b.vector }, threshold);
    for (const n of nodes) if (!n.isTarget) next.addWord(n.id, n.vector);
    engine = next;
    state.set(snapshot(null));
  }

  /** Ordered word ids along the widest bridge from targetA to targetB (for the reveal). */
  function bridgePath(): string[] {
    return engine ? engine.bridgePath() : [];
  }

  /** The weakest link on the current bridge path — the gap a hint should target. */
  function bottleneckLink() {
    return engine ? engine.bottleneckLink() : null;
  }

  /** The intermediate words placed this game, in insertion order (excludes targets). */
  function getWords(): string[] {
    return engine ? engine.getNodes().filter((n) => !n.isTarget).map((n) => n.id) : [];
  }

  /** Re-add previously saved words to the current puzzle (re-embedding each). */
  async function restoreWords(words: string[]): Promise<void> {
    if (!engine || words.length === 0) return;
    for (const w of words) {
      if (engine.has(w)) continue;
      const vec = await embedder.embed(w);
      engine.addWord(w, vec);
    }
    state.set(snapshot(null));
  }

  /** Re-embed the current puzzle (same words) with the active embedder and rebuild edges/gap. */
  async function reEmbedCurrent(): Promise<void> {
    if (!engine) return;
    const a = engine.targetA;
    const b = engine.targetB;
    const inter = engine.getNodes().filter((n) => !n.isTarget).map((n) => n.id);
    const [va, vb] = await Promise.all([embedder.embed(a), embedder.embed(b)]);
    const next = new GameEngine({ word: a, vector: va }, { word: b, vector: vb }, threshold);
    const vecs = await Promise.all(inter.map((w) => embedder.embed(w)));
    inter.forEach((w, i) => next.addWord(w, vecs[i]));
    engine = next;
    state.set(snapshot(null));
  }

  return {
    state: state as Readable<GameState>,
    stats: stats as Readable<Stats>,
    newGame,
    submitWord,
    skip,
    setEmbedder,
    setThreshold,
    rescore,
    reEmbedCurrent,
    bridgePath,
    bottleneckLink,
    getWords,
    restoreWords,
  };
}
