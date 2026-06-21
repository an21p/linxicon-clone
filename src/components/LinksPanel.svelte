<script lang="ts">
  import type { Edge } from '../lib/engine/types';
  import { sortedLinks } from '../lib/venn';

  export let edges: Edge[] = [];
  export let targetA = '';
  export let targetB = '';

  $: rows = sortedLinks(edges);
  function touchesTarget(e: Edge): boolean {
    return e.a === targetA || e.b === targetA || e.a === targetB || e.b === targetB;
  }
</script>

<aside class="links">
  <div class="head">
    <span class="title">links</span>
    <span class="count">{rows.length}</span>
  </div>

  {#if rows.length === 0}
    <p class="empty">no links yet — inscribe a word to draw the first thread.</p>
  {:else}
    <ul>
      {#each rows as e (`${e.a}~${e.b}`)}
        <li class:target={touchesTarget(e)}>
          <span class="pair">
            <span class="w">{e.a}</span>
            <span class="tie">~</span>
            <span class="w">{e.b}</span>
          </span>
          <span class="sim">
            <span class="bar"><span class="fill" style={`width:${e.sim * 100}%`}></span></span>
            <b>{(e.sim * 100).toFixed(0)}%</b>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .links {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-radius: 14px;
    border: 1px solid var(--panel-line);
    background: var(--panel);
    backdrop-filter: blur(8px);
    box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--panel-line);
  }
  .title {
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.24em;
    font-size: 11px;
    color: var(--gold);
  }
  .count {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--star-dim);
  }

  .empty {
    padding: 16px 14px;
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
    min-height: 0;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 12px;
  }
  li:hover { background: rgba(150, 168, 224, 0.06); }
  li.target { background: rgba(240, 198, 116, 0.06); }

  .pair { display: inline-flex; align-items: baseline; gap: 6px; min-width: 0; }
  .w {
    color: var(--star);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 8.5ch;
  }
  li.target .w { color: var(--gold-bright); }
  .tie { color: var(--muted); }

  .sim { display: inline-flex; align-items: center; gap: 8px; flex: none; }
  .bar {
    width: 44px;
    height: 3px;
    border-radius: 2px;
    background: var(--panel-line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--gold), var(--cyan));
    box-shadow: 0 0 8px rgba(116, 227, 218, 0.5);
  }
  .sim b {
    font-weight: 400;
    color: var(--star-dim);
    width: 3.2ch;
    text-align: right;
  }
  li.target .sim b { color: var(--gold-bright); }
</style>
