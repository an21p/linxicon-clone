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
  type SimLink = { source: string; target: string; sim: number; key: string };

  // `width`/`height` track the SVG's real rendered size (bound below), so the
  // viewBox maps 1:1 to pixels and nothing is ever scaled out of frame.
  let width = 800, height = 600;
  let simNodes: SimNode[] = [];
  let simLinks: SimLink[] = [];
  let positions: Record<string, { x: number; y: number }> = {};
  let sim: Simulation<SimNode, undefined> | null = null;
  let center = forceCenter(width / 2, height / 2);

  // keep every star fully inside the frame: clear its glow radius on each side,
  // plus extra room beneath targets for their label.
  function clampNode(n: SimNode) {
    const w = Math.max(1, width), h = Math.max(1, height);
    const m = n.isTarget ? 36 : 22;
    const bottom = n.isTarget ? 56 : 22;
    n.x = Math.max(m, Math.min(w - m, n.x ?? w / 2));
    n.y = Math.max(m, Math.min(h - bottom, n.y ?? h / 2));
  }

  function rebuild() {
    const existing = new Map(simNodes.map((n) => [n.id, n]));
    simNodes = nodes.map((n) => existing.get(n.id) ?? { id: n.id, isTarget: n.isTarget, x: width / 2 + (Math.random() - 0.5) * 40, y: height / 2 + (Math.random() - 0.5) * 40 });
    // `key` is captured here before d3's forceLink mutates source/target into
    // node objects in place (which would otherwise collapse the #each keys).
    simLinks = edges.map((e) => ({ source: e.a, target: e.b, sim: e.sim, key: `${e.a}-${e.b}` }));

    if (!sim) {
      sim = forceSimulation<SimNode>(simNodes)
        .force('charge', forceManyBody().strength(-400))
        .force('center', center)
        .force('collide', forceCollide(42))
        .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(120).strength(0.6))
        .on('tick', () => {
          for (const n of simNodes) clampNode(n); // keep nodes inside the frame
          positions = Object.fromEntries(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
        });
    } else {
      sim.nodes(simNodes);
      (sim.force('link') as any).links(simLinks);
      sim.alpha(0.8).restart();
    }
  }

  // recentre and re-settle whenever the frame is measured or resized
  $: if (sim && width && height) {
    center.x(width / 2).y(height / 2);
    for (const n of simNodes) clampNode(n);
    positions = Object.fromEntries(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    sim.alpha(Math.max(sim.alpha(), 0.25)).restart();
  }

  function pos(end: string | { id: string }) {
    return positions[typeof end === 'string' ? end : end.id];
  }
  // a gentle arc gives constellation lines a hand-drawn, charted feel
  function arc(s: { x: number; y: number }, t: { x: number; y: number }) {
    const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
    const dx = t.x - s.x, dy = t.y - s.y;
    const off = 0.09;
    return `M${s.x},${s.y} Q${mx - dy * off},${my + dx * off} ${t.x},${t.y}`;
  }

  $: nodes, edges, rebuild();
  onDestroy(() => sim?.stop());
</script>

<svg viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`} class="graph"
  preserveAspectRatio="xMidYMid meet"
  bind:clientWidth={width} bind:clientHeight={height}>
  <defs>
    <radialGradient id="vignette" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#10142c" />
      <stop offset="70%" stop-color="#0a0c1a" />
      <stop offset="100%" stop-color="#06070f" />
    </radialGradient>
    <radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#cfd8ff" />
      <stop offset="55%" stop-color="#7e8dc9" />
      <stop offset="100%" stop-color="#2c3766" />
    </radialGradient>
    <radialGradient id="targetGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff2d2" />
      <stop offset="55%" stop-color="#f0c674" />
      <stop offset="100%" stop-color="#8a5d1d" />
    </radialGradient>
    <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3.2" result="b" />
      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
    <filter id="bloomSoft" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="7" />
    </filter>
  </defs>

  <rect x="0" y="0" {width} {height} fill="url(#vignette)" />

  <!-- faint celestial graticule: the chart's measuring grid -->
  <g class="graticule">
    {#each [0.2, 0.4, 0.6, 0.8] as f}
      <line x1={width * f} y1="0" x2={width * f} y2={height} />
      <line x1="0" y1={height * f} x2={width} y2={height * f} />
    {/each}
    <ellipse cx={width / 2} cy={height / 2} rx={width * 0.42} ry={height * 0.3} class="ecliptic" />
  </g>

  <!-- constellation lines -->
  {#each simLinks as l (l.key)}
    {#if pos(l.source) && pos(l.target)}
      {@const s = pos(l.source)}
      {@const t = pos(l.target)}
      <path d={arc(s, t)} class="link-glow"
        stroke-width={2 + l.sim * 7} stroke-opacity={0.12 + l.sim * 0.22} />
      <path d={arc(s, t)} class="link"
        stroke-width={0.6 + l.sim * 2.4} stroke-opacity={0.35 + l.sim * 0.5}
        stroke-dasharray={l.sim > 0.55 ? 'none' : '1 6'} />
    {/if}
  {/each}

  <!-- stars -->
  {#each simNodes as n (n.id)}
    {#if positions[n.id]}
      {@const p = positions[n.id]}
      {@const isTarget = n.id === targetA || n.id === targetB}
      <g transform={`translate(${p.x}, ${p.y})`} class:pop={n.id === lastWord} class:target={isTarget}>
        <circle r={isTarget ? 30 : 19} class="halo"
          fill={isTarget ? 'url(#targetGlow)' : 'url(#starGlow)'} filter="url(#bloomSoft)" />
        <circle r={isTarget ? 21 : 15} class="disc"
          fill={isTarget ? 'url(#targetGlow)' : 'url(#starGlow)'} filter="url(#bloom)"
          stroke={isTarget ? '#ffe6ad' : '#aeb9ef'} stroke-width={isTarget ? 1.4 : 1}
          stroke-opacity="0.7" />
        {#if isTarget}
          <!-- a four-point sparkle marks a named star -->
          <path class="sparkle" d="M0,-34 L2.4,-2.4 34,0 2.4,2.4 0,34 -2.4,2.4 -34,0 -2.4,-2.4 Z" />
        {/if}
        <text text-anchor="middle" dy={isTarget ? 38 : 4} class:label-target={isTarget}
          fill={isTarget ? '#ffe6ad' : '#e7ebff'} font-size={isTarget ? 14 : 11.5}>{n.id}</text>
      </g>
    {/if}
  {/each}
</svg>

<style>
  .graph {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 14px;
    border: 1px solid var(--panel-line);
    box-shadow:
      inset 0 0 90px rgba(0, 0, 0, 0.6),
      0 24px 60px -30px rgba(0, 0, 0, 0.9);
  }

  .graticule line,
  .ecliptic {
    stroke: rgba(150, 168, 224, 0.08);
    stroke-width: 1;
    fill: none;
  }
  .ecliptic {
    stroke: rgba(240, 198, 116, 0.1);
    stroke-dasharray: 2 9;
  }

  .link-glow { fill: none; stroke: #74e3da; }
  .link { fill: none; stroke: #9fb0ff; stroke-linecap: round; }

  .disc { transition: r 0.3s ease; }
  text {
    user-select: none;
    pointer-events: none;
    font-family: var(--mono);
    letter-spacing: 0.04em;
    paint-order: stroke;
    stroke: rgba(6, 7, 15, 0.85);
    stroke-width: 3px;
  }
  .label-target {
    font-family: var(--display);
    font-weight: 500;
    letter-spacing: 0.02em;
    text-transform: lowercase;
  }

  .sparkle {
    fill: rgba(255, 230, 173, 0.55);
    animation: twinkle 3.4s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  .target .halo { animation: breathe 4.5s ease-in-out infinite; }

  @keyframes twinkle {
    0%, 100% { opacity: 0.35; transform: scale(0.9) rotate(0deg); }
    50% { opacity: 0.85; transform: scale(1.08) rotate(45deg); }
  }
  @keyframes breathe {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 1; }
  }

  /* a placed star ignites: flares bright, then settles */
  .pop .disc { animation: ignite 0.7s cubic-bezier(0.2, 0.9, 0.2, 1); }
  .pop .halo { animation: flare 0.9s ease-out; }
  @keyframes ignite {
    0% { transform: scale(0.1); opacity: 0; }
    45% { transform: scale(1.5); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes flare {
    0% { opacity: 0; }
    35% { opacity: 1; }
    100% { opacity: 0.85; }
  }
</style>
