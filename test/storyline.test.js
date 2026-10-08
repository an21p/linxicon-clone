'use strict';
// Unit tests for block splitting, analysis and ordering (run `npm run build` first; `npm test` does).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { analyze, buildStory } = require('../out/core.js');

const example = fs.readFileSync(path.join(__dirname, '..', 'examples', 'rdb.q'), 'utf8');
const byName = (blocks, name) => blocks.find((b) => b.names.includes(name));
const namesOf = (blocks, ids) => ids.map((id) => blocks[id].names[0]);
const labelsIn = (story, key) =>
  story.sections.find((s) => s.key === key).items.map((it) => story.blocks[it.id].label);
const spans = (src) => analyze(src).blocks.map((b) => [b.role, b.startLine, b.endLine]);

test('multi-line definitions continue on indented lines, across blank lines', () => {
  assert.deepEqual(spans('f:{[x]\n  a:x+1;\n\n  a*2 }\ng:1\n'), [['function', 0, 3], ['constant', 4, 4]]);
});

test('a multi-line string continues its block even when a line starts in column 0', () => {
  assert.deepEqual(spans('s:"first\nsecond"\nt:1\n'), [['constant', 0, 1], ['constant', 2, 2]]);
});

test('comments directly above a block attach to it; a blank line detaches them', () => {
  const { blocks } = analyze('a:1\n/ about f\nf:{x}\n\n/ loose note\n\ng:{y}\n');
  assert.deepEqual(blocks.map((b) => [b.role, b.startLine, b.codeLine]),
    [['constant', 0, 0], ['function', 1, 2], ['comment', 4, 4], ['function', 6, 6]]);
  assert.deepEqual(blocks[3].notes, [2]);
  assert.equal(blocks[1].code, 'f:{x}');
});

test('a comment at the top of the file is the overview, not the first block\'s doc', () => {
  assert.deepEqual(spans('/ changelog\n/ more\n"v1.0"\n'), [['header', 0, 1], ['statement', 2, 2]]);
  // ...unless it is a section banner
  assert.deepEqual(spans('/ ---------\n/ utils\n\nf:{x}\n'), [['comment', 0, 1], ['function', 3, 3]]);
});

test('block comments and end-of-script are recognised', () => {
  const src = 'a:1\n/\nf:{x}\nnot code\n\\\n\nb:2\n\\\nignored:3\n';
  assert.deepEqual(spans(src), [['constant', 0, 0], ['comment', 1, 4], ['constant', 6, 6], ['trailer', 7, 9]]);
});

test('\\d sets the namespace of the definitions that follow', () => {
  const { blocks } = analyze('\\d .cfg\nport:5010\n\\d .\nf:{x}\n');
  assert.deepEqual(blocks.map((b) => [b.role, b.names, b.namespace]),
    [['namespace', [], ''], ['constant', ['.cfg.port'], '.cfg'], ['namespace', [], '.cfg'], ['function', ['f'], '']]);
});

test('roles: system, constant, table, function, computed, handler, statement', () => {
  const { blocks } = analyze([
    '\\l util.q',
    'n:10',
    't:([] a:`long$())',
    'f:{x+n}',
    'v:f 1',
    'cfg:get `:cfg',
    '.z.ts:{f 2}',
    'f 3',
  ].join('\n'));
  assert.deepEqual(blocks.map((b) => b.role),
    ['system', 'constant', 'table', 'function', 'computed', 'computed', 'handler', 'statement']);
});

test('table columns are not definitions; q-sql columns are not references', () => {
  const { blocks } = analyze('price:1\nt:([] sym:`a`b; price:1 2)\nf:{select price from t}\n');
  assert.deepEqual(blocks[1].names, ['t']);
  assert.deepEqual(namesOf(blocks, byName(blocks, 'f').uses), ['t']);
});

test('references follow the KX scoping rules: params, locals, namespaces, symbols', () => {
  const { blocks } = analyze([
    'a:1',
    'b:2',
    '\\d .ns',
    'b:3',
    'h:{[a] a+b}',          // param a shadows global a; b is .ns.b (no fallback to root)
    'g:{c:1; c+h[1]}',      // local c; h is .ns.h
    '\\d .',
    '.z.ts:{value `.ns.g}', // a symbol naming a function is a reference
  ].join('\n'));
  assert.deepEqual(namesOf(blocks, byName(blocks, '.ns.h').uses), ['.ns.b']);
  assert.deepEqual(namesOf(blocks, byName(blocks, '.ns.g').uses), ['.ns.h']);
  assert.deepEqual(byName(blocks, '.z.ts').refs.map((r) => [r.name, r.via]), [['.ns.g', 'symbol']]);
});

test('several definitions on one line, including a .z handler', () => {
  const { blocks } = analyze('\\d .u\ndel:{x};.z.pc:{del[;x]}\n');
  assert.deepEqual(blocks[1].names, ['.u.del', '.z.pc']);
});

test('top-down: each main step is followed by its helpers, depth-first in first-use order', () => {
  const story = buildStory([
    'leaf:{x}',
    'helperB:{leaf x}',
    'helperA:{x+1}',
    'run:{helperA helperB x}',
    'api:{x}',
    'run 1',
  ].join('\n'));
  assert.deepEqual(labelsIn(story, 'main'), ['run 1', 'run', 'helperA', 'helperB', 'leaf']);
  assert.deepEqual(labelsIn(story, 'api'), ['api']);
  assert.deepEqual(story.sections.find((s) => s.key === 'main').items.map((i) => i.depth), [0, 1, 2, 2, 3]);
});

test('bottom-up: every function appears after everything it uses', () => {
  const story = buildStory(example, { mode: 'bottom-up' });
  const seen = new Set();
  for (const s of story.sections) {
    for (const { id } of s.items) {
      const b = story.blocks[id];
      if (b.role === 'function') {
        for (const u of b.uses) if (story.blocks[u].role === 'function') assert.ok(seen.has(u), `${b.label} before its dependency`);
      }
      seen.add(id);
    }
  }
});

test('every source line appears exactly once in the story, except \\d lines', () => {
  const lines = example.split('\n');
  for (const mode of ['top-down', 'bottom-up']) {
    const story = buildStory(example, { mode });
    const storyLines = story.text.split('\n');
    const mapped = story.lineMap.filter((l, i) => l !== null && storyLines[i] === lines[l]);
    assert.equal(mapped.length, new Set(mapped).size, `${mode}: duplicated lines`);
    const missing = lines.map((_, i) => i).filter((i) => !mapped.includes(i) && lines[i].trim() !== '');
    assert.deepEqual(missing.map((i) => lines[i]), ['\\d .cfg', '\\d .'], mode);
  }
});

test('story lines map back to source and links point at the block range', () => {
  const story = buildStory('f:{x}\n\ng:{f x}\ng 1\n');
  assert.equal(story.text.split('\n')[story.storyLineOf(2)], 'g:{f x}');
  const link = story.links.find((l) => l.from === 2);
  assert.equal(story.text.split('\n')[link.line].slice(link.start, link.end), 'L3');
});
