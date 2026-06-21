<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide,
    type Simulation,
  } from 'd3-force';
  import type { WordNode, Edge } from '../lib/engine/types';
  import { overlapDistance } from '../lib/venn';

  export let nodes: WordNode[] = [];
  export let edges: Edge[] = [];
  export let targetA = '';
  export let targetB = '';
  export let lastWord: string | null = null;
  export let threshold = 0.41;
  export let revealPath: string[] = [];
  export let revealStep = -1;

  $: revealing = revealStep >= 0;
  $: revealSet = new Set(revealing ? revealPath.slice(0, revealStep + 1) : []);
  $: revealActive = revealing ? revealPath[revealStep] : null;
  $: revealSegments = revealing
    ? revealPath.slice(0, revealStep + 1).slice(1).map((id, i) => [revealPath[i], id] as [string, string])
    : [];

  type SimNode = { id: string; isTarget: boolean; r: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null };
  type SimLink = { source: string; target: string; sim: number; key: string };

  const R_TARGET = 62;
  const R_WORD = 44;
  const radiusOf = (isTarget: boolean) => (isTarget ? R_TARGET : R_WORD);

  let width = 800, height = 600;
  let simNodes: SimNode[] = [];
  let simLinks: SimLink[] = [];
  let positions: Record<string, { x: number; y: number }> = {};
  let sim: Simulation<SimNode, undefined> | null = null;
  let center = forceCenter(width / 2, height / 2);

  let svgEl: SVGSVGElement;
  let dragNode: SimNode | null = null;
  let dragId: number | null = null;

  const IDLE_ALPHA = 0.015;
  const DRAG_ALPHA = 0.3;
  const BASE_LINK_STRENGTH = 0.9;
  const DRAG_LINK_STRENGTH = 1;
  const RELEASE_ALPHA = 0.12;

  function linkForce() {
    return sim?.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined;
  }

  // keep each circle fully inside the frame (clear its own radius on every side)
  function clampNode(n: SimNode) {
    const w = Math.max(1, width), h = Math.max(1, height);
    const m = n.r + 4;
    const cx = (v: number) => Math.max(m, Math.min(w - m, v));
    const cy = (v: number) => Math.max(m, Math.min(h - m, v));
    n.x = cx(n.x ?? w / 2);
    n.y = cy(n.y ?? h / 2);
    if (n.fx != null) n.fx = cx(n.fx);
    if (n.fy != null) n.fy = cy(n.fy);
  }

  function rebuild() {
    const existing = new Map(simNodes.map((n) => [n.id, n]));
    simNodes = nodes.map((n) =>
      existing.get(n.id) ?? {
        id: n.id, isTarget: n.isTarget, r: radiusOf(n.isTarget),
        x: width / 2 + (Math.random() - 0.5) * 60,
        y: height / 2 + (Math.random() - 0.5) * 60,
      });
    simLinks = edges.map((e) => ({ source: e.a, target: e.b, sim: e.sim, key: `${e.a}-${e.b}` }));

    const byId = new Map(simNodes.map((n) => [n.id, n]));
    // connected pairs overlap more as similarity rises; unconnected pairs are
    // pushed apart by charge so they never overlap (sub-threshold = no overlap).
    // TIGHTEN pulls linked circles into a closer cluster with deeper overlaps.
    const TIGHTEN = 0.66;
    const linkDist = (l: SimLink) => {
      const ra = byId.get(l.source)?.r ?? R_WORD;
      const rb = byId.get(l.target)?.r ?? R_WORD;
      return overlapDistance(ra, rb, l.sim, threshold) * TIGHTEN;
    };

    if (!sim) {
      sim = forceSimulation<SimNode>(simNodes)
        .velocityDecay(0.3)
        .alphaTarget(IDLE_ALPHA)
        .force('charge', forceManyBody().strength(-130))
        // collide on a small core so linked circles overlap deeply, but no two
        // centres ever stack exactly
        .force('collide', forceCollide<SimNode>((n) => n.r * 0.3).strength(0.9))
        .force('center', center)
        .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(linkDist).strength(BASE_LINK_STRENGTH))
        .on('tick', () => {
          for (const n of simNodes) clampNode(n);
          positions = Object.fromEntries(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
        });
    } else {
      sim.nodes(simNodes);
      const link = sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>;
      link.links(simLinks).distance(linkDist);
      sim.alpha(0.85).restart();
    }
  }

  $: if (sim && width && height) {
    center.x(width / 2).y(height / 2);
    for (const n of simNodes) clampNode(n);
    positions = Object.fromEntries(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    sim.alpha(Math.max(sim.alpha(), 0.25)).restart();
  }

  const endId = (end: string | { id: string }) => (typeof end === 'string' ? end : end.id);
  function neighborsOf(id: string): Set<string> {
    const s = new Set<string>();
    for (const l of simLinks) {
      const a = endId(l.source), b = endId(l.target);
      if (a === id) s.add(b);
      else if (b === id) s.add(a);
    }
    return s;
  }
  // freeze everything except the grabbed circle and its overlaps, so only that
  // local cluster reacts to the drag
  function pinOthers(n: SimNode) {
    const keep = neighborsOf(n.id);
    for (const m of simNodes) {
      if (m === n || keep.has(m.id)) continue;
      m.fx = m.x ?? 0;
      m.fy = m.y ?? 0;
    }
  }
  function releaseAll() {
    for (const m of simNodes) { m.fx = null; m.fy = null; }
  }

  function dragStart(e: PointerEvent, n: SimNode) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragNode = n;
    dragId = e.pointerId;
    pinOthers(n);
    linkForce()?.strength(DRAG_LINK_STRENGTH);
    n.fx = n.x ?? 0;
    n.fy = n.y ?? 0;
    sim?.alphaTarget(DRAG_ALPHA).restart();
  }
  function dragMove(e: PointerEvent, n: SimNode) {
    if (dragNode !== n || e.pointerId !== dragId) return;
    const r = svgEl.getBoundingClientRect();
    n.fx = e.clientX - r.left;
    n.fy = e.clientY - r.top;
    sim?.alpha(Math.max(sim.alpha(), DRAG_ALPHA)).restart();
  }
  function dragEnd(e: PointerEvent, n: SimNode) {
    if (dragNode !== n) return;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    linkForce()?.strength(BASE_LINK_STRENGTH);
    n.vx = 0; n.vy = 0; // ease into place instead of snapping
    releaseAll();
    dragNode = null;
    dragId = null;
    sim?.alphaTarget(IDLE_ALPHA);
    sim?.alpha(RELEASE_ALPHA).restart();
  }

  $: nodeKey = nodes.map((n) => n.id).join('|');
  $: edgeKey = edges.map((e) => `${e.a}~${e.b}:${e.sim.toFixed(3)}`).join('|');
  $: nodeKey, edgeKey, rebuild();
  onDestroy(() => sim?.stop());
</script>

<svg viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`} class="venn"
  preserveAspectRatio="xMidYMid meet"
  bind:this={svgEl}
  bind:clientWidth={width} bind:clientHeight={height}>
  <defs>
    <radialGradient id="venn-vignette" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#10142c" />
      <stop offset="70%" stop-color="#0a0c1a" />
      <stop offset="100%" stop-color="#06070f" />
    </radialGradient>
    <filter id="venn-soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="0.6" />
    </filter>
  </defs>

  <rect x="0" y="0" {width} {height} fill="url(#venn-vignette)" />

  <g class="graticule">
    {#each [0.2, 0.4, 0.6, 0.8] as f}
      <line x1={width * f} y1="0" x2={width * f} y2={height} />
      <line x1="0" y1={height * f} x2={width} y2={height * f} />
    {/each}
  </g>

  <!-- bridge trace: the widest path A→B, drawn as it's revealed -->
  {#each revealSegments as [a, b], i (`${a}-${b}`)}
    {@const s = positions[a]}
    {@const t = positions[b]}
    {#if s && t}
      <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} class="trace" style={`--i:${i}`} />
    {/if}
  {/each}

  <!-- translucent word circles; overlaps blend where words are similar -->
  {#each simNodes as n (n.id)}
    {#if positions[n.id]}
      {@const p = positions[n.id]}
      {@const isTarget = n.id === targetA || n.id === targetB}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g class="bubble" transform={`translate(${p.x}, ${p.y})`}
        class:pop={n.id === lastWord} class:target={isTarget} class:grabbing={dragNode === n}
        class:lit={revealSet.has(n.id)} class:active={n.id === revealActive}
        class:dim={revealing && !revealSet.has(n.id)}
        on:pointerdown={(e) => dragStart(e, n)}
        on:pointermove={(e) => dragMove(e, n)}
        on:pointerup={(e) => dragEnd(e, n)}
        on:pointercancel={(e) => dragEnd(e, n)}>
        <circle r={n.r} class="disc"
          fill={isTarget ? 'rgba(240, 198, 116, 0.16)' : 'rgba(126, 141, 201, 0.16)'}
          stroke={isTarget ? 'rgba(255, 230, 173, 0.85)' : 'rgba(174, 185, 239, 0.7)'}
          stroke-width={isTarget ? 1.6 : 1.1} filter="url(#venn-soft)" />
        <text text-anchor="middle" dy="0.34em" class:label-target={isTarget}
          fill={isTarget ? '#ffe6ad' : '#e7ebff'} font-size={isTarget ? 21 : 16}>{n.id}</text>
      </g>
    {/if}
  {/each}
</svg>

<style>
  .venn {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 14px;
    border: 1px solid var(--panel-line);
    box-shadow:
      inset 0 0 90px rgba(0, 0, 0, 0.6),
      0 24px 60px -30px rgba(0, 0, 0, 0.9);
  }

  .graticule line {
    stroke: rgba(150, 168, 224, 0.08);
    stroke-width: 1;
    fill: none;
  }

  .bubble { cursor: grab; touch-action: none; transition: opacity 0.5s ease; }
  .bubble.grabbing { cursor: grabbing; }

  /* --- result reveal --- */
  .bubble.dim { opacity: 0.16; }
  .bubble.lit { opacity: 1; }
  .bubble.active .disc { animation: spotlight 0.7s ease; }
  .bubble.active text { fill: #fff6e0; }
  .trace {
    stroke: #74e3da;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-opacity: 0.9;
    filter: url(#venn-soft);
    stroke-dasharray: 800;
    stroke-dashoffset: 800;
    animation: draw-trace 0.6s ease forwards;
  }
  @keyframes draw-trace { to { stroke-dashoffset: 0; } }
  @keyframes spotlight {
    0% { transform: scale(1); }
    45% { transform: scale(1.4); }
    100% { transform: scale(1); }
  }
  .disc { transition: r 0.3s ease; mix-blend-mode: screen; }
  .target .disc { animation: breathe 4.5s ease-in-out infinite; }

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

  .pop .disc { animation: ignite 0.7s cubic-bezier(0.2, 0.9, 0.2, 1); }
  @keyframes ignite {
    0% { transform: scale(0.1); opacity: 0; }
    45% { transform: scale(1.4); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes breathe {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 1; }
  }
</style>
