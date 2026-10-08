'use strict';
// Orders analyzed blocks into a storyline and renders it as a reading view.
//
// Top-down (default): context first (overview, setup, configuration, data), then what
// the script *does*, each step immediately followed by the helpers it relies on
// ("stepdown rule"), then the event handlers and externally-called API.
//
// Bottom-up: the same context, then building blocks leaves-first so every function is
// introduced before anything that calls it, ending with the program's main flow.

const { analyze } = require('./analyze');

const SECTIONS = {
  overview: ['Overview', 'what this file is about'],
  setup: ['Setup', 'loads, namespaces and system settings'],
  config: ['Configuration', 'constants the rest of the code reads'],
  data: ['Data model', 'tables and schemas'],
  main: ['Main flow', 'what runs when the script loads, in order; each step is followed by the helpers it uses'],
  handlers: ['Event handlers', '.z.* callbacks: what runs on IPC messages, timers and connections'],
  api: ['Entry points', 'functions nothing in this file calls: invoked from outside (IPC, other scripts) or unused'],
  blocks: ['Building blocks', 'functions, leaves first: each one only uses what is already above it'],
  other: ['Other definitions', 'only reachable through each other (mutual recursion)'],
  appendix: ['Appendix', 'text after the end-of-script \\ (ignored by q)'],
};

const TOP_DOWN = ['overview', 'setup', 'config', 'data', 'main', 'handlers', 'api', 'other', 'appendix'];
const BOTTOM_UP = ['overview', 'setup', 'config', 'data', 'blocks', 'other', 'handlers', 'main', 'appendix'];

/**
 * @typedef {{ id: number, depth: number, parent: number|null }} Item
 * @typedef {{ key: string, title: string, blurb: string, items: Item[] }} Section
 */

/**
 * @param {import('./analyze').Block[]} blocks
 * @param {'top-down'|'bottom-up'} mode
 * @returns {Section[]}
 */
function order(blocks, mode) {
  const placed = new Set();
  const buckets = Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, []]));
  const put = (key, id, depth = 0, parent = null) => {
    placed.add(id);
    buckets[key].push({ id, depth, parent });
  };
  const byRole = (...roles) => blocks.filter((b) => roles.includes(b.role)).map((b) => b.id);
  const isHelper = (id) => blocks[id].role === 'function';

  byRole('header').forEach((id) => put('overview', id));
  byRole('system').forEach((id) => put('setup', id));
  byRole('namespace').forEach((id) => placed.add(id)); // shown as "in .ns" on each block
  byRole('constant').forEach((id) => put('config', id));
  byRole('table').forEach((id) => put('data', id));
  byRole('trailer').forEach((id) => put('appendix', id));
  byRole('comment').forEach((id) => placed.add(id)); // rendered as notes

  const steps = byRole('statement', 'computed');
  const handlers = byRole('handler');
  const roots = () => byRole('function').filter((id) => !placed.has(id) && blocks[id].usedBy.length === 0);

  if (mode === 'bottom-up') {
    // post-order: callees before callers
    const visiting = new Set();
    const visit = (id) => {
      if (placed.has(id) || visiting.has(id)) return;
      visiting.add(id);
      blocks[id].uses.filter(isHelper).forEach(visit);
      visiting.delete(id);
      if (isHelper(id)) put('blocks', id);
    };
    [...steps, ...handlers].forEach((id) => blocks[id].uses.filter(isHelper).forEach(visit));
    roots().forEach(visit);
    byRole('function').filter((id) => !placed.has(id)).forEach((id) => put('other', id));
    handlers.forEach((id) => put('handlers', id));
    steps.forEach((id) => put('main', id));
  } else {
    // pre-order: each block followed by the helpers it uses, in first-use order
    const tell = (key, id, depth, parent) => {
      if (placed.has(id)) return;
      put(key, id, depth, parent);
      blocks[id].uses.filter(isHelper).forEach((u) => tell(key, u, depth + 1, id));
    };
    steps.forEach((id) => tell('main', id, 0, null));
    handlers.forEach((id) => tell('handlers', id, 0, null));
    roots().forEach((id) => tell('api', id, 0, null));
    byRole('function').filter((id) => !placed.has(id)).forEach((id) => tell('other', id, 0, null));
  }

  return (mode === 'bottom-up' ? BOTTOM_UP : TOP_DOWN)
    .map((key) => {
      const [title, blurb] = SECTIONS[key];
      const plain = mode === 'bottom-up' && key === 'main' ? blurb.replace(/; each step.*$/, '') : blurb;
      return { key, title, blurb: plain, items: buckets[key] };
    })
    .filter((s) => s.items.length);
}

const RULE = '/ ' + '═'.repeat(76);

function list(ids, blocks, max = 5) {
  if (!ids.length) return '';
  const names = ids.map((id) => blocks[id].names[0] || shortLabel(blocks[id]));
  const uniq = [...new Set(names)];
  return uniq.length > max ? uniq.slice(0, max).join(', ') + `, +${uniq.length - max}` : uniq.join(', ');
}

function shortLabel(b, max = 24) {
  return b.label.length > max ? b.label.slice(0, max - 1) + '…' : b.label;
}

function lineRange(b) {
  return b.startLine === b.endLine ? `L${b.startLine + 1}` : `L${b.startLine + 1}-${b.endLine + 1}`;
}

/**
 * Builds the storyline for a q source.
 *
 * @param {string} source
 * @param {{ mode?: 'top-down'|'bottom-up', fileName?: string, annotate?: boolean }} [opts]
 * @returns {{
 *   text: string,
 *   sections: Section[],
 *   blocks: import('./analyze').Block[],
 *   lineMap: (number|null)[],                // story line -> source line
 *   blockAt: (number|null)[],                // story line -> block id
 *   storyLineOf: (sourceLine: number) => number|null,
 *   links: { line: number, start: number, end: number, from: number, to: number }[],
 * }}
 */
function buildStory(source, opts = {}) {
  const mode = opts.mode || 'top-down';
  const annotate = opts.annotate !== false;
  const { blocks } = analyze(source);
  const sections = order(blocks, mode);

  const out = [];
  const lineMap = [];
  const blockAt = [];
  const links = [];
  const emit = (text, src = null, block = null) => { out.push(text); lineMap.push(src); blockAt.push(block); };
  const emitBlockText = (b) => b.text.split('\n').forEach((l, k) => emit(l, b.startLine + k, b.id));

  const code = blocks.filter((b) => !['header', 'comment', 'trailer', 'namespace'].includes(b.role));
  const fns = code.filter((b) => b.role === 'function' || b.role === 'handler').length;
  emit(`/ q storyline · ${mode} · ${opts.fileName || 'untitled'} · ${code.length} blocks, ${fns} functions`);
  emit('/ reading view: blocks are reordered for understanding, not for execution');

  sections.forEach((section, n) => {
    emit('');
    emit(RULE);
    emit(`/ ${n + 1} · ${section.title.toUpperCase()} — ${section.blurb}`);
    emit(RULE);
    for (const item of section.items) {
      const b = blocks[item.id];
      emit('');
      if (annotate && section.key !== 'overview' && section.key !== 'appendix') {
        const marker = item.depth ? '  '.repeat(item.depth - 1) + '↳' : '▸';
        const range = lineRange(b);
        let header = `/ ${marker} ${b.label} · `;
        const start = header.length;
        header += range;
        links.push({ line: out.length, start, end: start + range.length, from: b.startLine, to: b.endLine });
        header += ` · ${b.role}`;
        if (b.namespace && b.role !== 'namespace') header += ` in ${b.namespace}`;
        if (item.parent !== null) header += ` · helper of ${list([item.parent], blocks)}`;
        const uses = list(b.uses, blocks);
        const usedBy = list(b.usedBy.filter((id) => id !== item.parent), blocks);
        if (uses) header += ` · uses ${uses}`;
        if (usedBy) header += ` · ${item.parent !== null ? 'also used by' : 'used by'} ${usedBy}`;
        else if (!b.usedBy.length && (b.role === 'constant' || b.role === 'table')) header += ' · unused';
        emit(header, null, b.id);
      }
      for (const noteId of b.notes) emitBlockText(blocks[noteId]);
      emitBlockText(b);
    }
  });
  emit('');

  const storyLineOf = (sourceLine) => {
    const exact = lineMap.indexOf(sourceLine);
    if (exact >= 0) return exact;
    // a blank or dropped line: fall back to the nearest mapped line above it
    let best = null, bestSrc = -1;
    lineMap.forEach((src, i) => { if (src !== null && src <= sourceLine && src > bestSrc) { best = i; bestSrc = src; } });
    return best;
  };

  return { text: out.join('\n'), sections, blocks, lineMap, blockAt, storyLineOf, links };
}

module.exports = { buildStory, order, SECTIONS };
