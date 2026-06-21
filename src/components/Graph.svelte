<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide,
    type Simulation,
  } from 'd3-force';
  import type { WordNode, Edge } from '../lib/engine/types';

  export let nodes: WordNode[] = [];
  export let edges: Edge[] = [];
  export let targetA = '';
  export let targetB = '';
  export let lastWord: string | null = null;

  type SimNode = { id: string; isTarget: boolean; x?: number; y?: number; fx?: number; fy?: number };
  type SimLink = { source: string; target: string; sim: number };

  let width = 800, height = 600;
  let simNodes: SimNode[] = [];
  let simLinks: SimLink[] = [];
  let positions: Record<string, { x: number; y: number }> = {};
  let sim: Simulation<SimNode, undefined> | null = null;

  function rebuild() {
    const existing = new Map(simNodes.map((n) => [n.id, n]));
    simNodes = nodes.map((n) => existing.get(n.id) ?? { id: n.id, isTarget: n.isTarget, x: width / 2 + (Math.random() - 0.5) * 40, y: height / 2 + (Math.random() - 0.5) * 40 });
    simLinks = edges.map((e) => ({ source: e.a, target: e.b, sim: e.sim }));

    if (!sim) {
      sim = forceSimulation<SimNode>(simNodes)
        .force('charge', forceManyBody().strength(-400))
        .force('center', forceCenter(width / 2, height / 2))
        .force('collide', forceCollide(40))
        .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(120).strength(0.6))
        .on('tick', () => {
          positions = Object.fromEntries(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
        });
    } else {
      sim.nodes(simNodes);
      (sim.force('link') as any).links(simLinks);
      sim.alpha(0.8).restart();
    }
  }

  $: nodes, edges, rebuild();
  onDestroy(() => sim?.stop());
</script>

<svg viewBox={`0 0 ${width} ${height}`} class="graph">
  {#each simLinks as l (l.source + '-' + l.target)}
    {#if positions[typeof l.source === 'string' ? l.source : (l.source as any).id] && positions[typeof l.target === 'string' ? l.target : (l.target as any).id]}
      {@const s = positions[typeof l.source === 'string' ? l.source : (l.source as any).id]}
      {@const t = positions[typeof l.target === 'string' ? l.target : (l.target as any).id]}
      <line x1={s.x} y1={s.y} x2={t.x} y2={t.y}
        stroke="#6b7fd7" stroke-width={1 + l.sim * 4} stroke-opacity={0.3 + l.sim * 0.5} />
    {/if}
  {/each}
  {#each simNodes as n (n.id)}
    {#if positions[n.id]}
      {@const p = positions[n.id]}
      {@const isTarget = n.id === targetA || n.id === targetB}
      <g transform={`translate(${p.x}, ${p.y})`} class:pop={n.id === lastWord}>
        <circle r="26" fill={isTarget ? '#e8c547' : '#2b3b6b'} stroke="#cdd6ff" stroke-width="2" />
        <text text-anchor="middle" dy="5" fill={isTarget ? '#1a1a2e' : '#eaeefb'} font-size="13">{n.id}</text>
      </g>
    {/if}
  {/each}
</svg>

<style>
  .graph { width: 100%; height: 100%; display: block; background: #11152b; border-radius: 12px; }
  .pop circle { animation: pop 0.4s ease-out; }
  @keyframes pop { from { r: 4; } to { r: 26; } }
  text { user-select: none; pointer-events: none; font-family: system-ui, sans-serif; }
</style>
