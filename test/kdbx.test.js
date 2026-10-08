'use strict';
// Checks q Storyline's analysis against q itself (KDB-X), on examples/ and on the
// real-world corpus fetched by `npm run corpus`. For every code block, q must agree that:
//   - the block is a complete statement on its own (parse), so blocks split where q does
//   - it defines exactly the names we found (parse tree assignments)
//   - it refers to exactly the file's globals we found (globals of the compiled lambda)
// Nothing is executed; see test/kdbx/oracle.q.
//
// Skips unless a licensed q is available, found in this order:
//   QSTORY_Q        a q command, e.g. "q" or "$HOME/.kx/bin/q"
//   q on the PATH
//   QSTORY_PYTHON   (default: python3) with KDB-X Python (pip install pykx) licensed,
//                   e.g. via the KDB_LICENSE_B64 environment variable
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze } = require('../out/core.js');

const ORACLE = path.join(__dirname, 'kdbx', 'oracle.q');
const ROOT = path.join(__dirname, '..');
const CODE_ROLES = new Set(['constant', 'table', 'computed', 'statement', 'function', 'handler']);

function findQ() {
  const candidates = [process.env.QSTORY_Q, 'q'].filter(Boolean);
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['-q'], { input: '-1 "qstory-ok";exit 0\n', encoding: 'utf8', shell: cmd.includes(' ') });
    if (r.stdout && r.stdout.includes('qstory-ok')) return { kind: 'q', cmd };
  }
  const py = process.env.QSTORY_PYTHON || 'python3';
  const r = spawnSync(py, ['-c', 'import pykx as kx; print("qstory", kx.licensed)'], { encoding: 'utf8' });
  if (r.stdout && r.stdout.includes('qstory True')) return { kind: 'pykx', cmd: py };
  return null;
}

function runOracle(q, blocks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qstory-'));
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.json');
  fs.writeFileSync(input, JSON.stringify(blocks));
  const env = { ...process.env, QSTORY_IN: input, QSTORY_OUT: output, QSTORY_ORACLE: ORACLE };
  const r = q.kind === 'q'
    ? spawnSync(q.cmd, [ORACLE, '-q'], { env, input: '', encoding: 'utf8', shell: q.cmd.includes(' ') })
    : spawnSync(q.cmd, ['-c', 'import os, pykx as kx; kx.q(\'{system "l ",string x}\', os.environ["QSTORY_ORACLE"])'],
      { env, encoding: 'utf8' });
  if (!fs.existsSync(output)) throw new Error(`oracle produced no output:\n${r.stdout}\n${r.stderr}`);
  const results = JSON.parse(fs.readFileSync(output, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return Array.isArray(results) ? results : [results];
}

function qFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.q')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'examples'));
  walk(path.join(ROOT, '.corpus'));
  return out;
}

const sorted = (xs) => [...new Set(xs)].sort();

/** Differences between our analysis of one file and q's view of it. */
function compare(file, src, q) {
  const model = analyze(src);
  const blocks = model.blocks.filter((b) => CODE_ROLES.has(b.role));
  if (!blocks.length) return { checked: 0, problems: [] };
  const results = runOracle(q, blocks.map((b) => ({ id: b.id, code: b.code, namespace: b.namespace })));
  const problems = [];
  for (const r of results) {
    const b = model.blocks[r.id];
    const where = `${path.relative(ROOT, file)}:${b.codeLine + 1} ${b.label}`;
    if (!r.parsed || !r.compiled) {
      problems.push(`${where}: q could not ${r.parsed ? 'compile' : 'parse'} the block on its own (${r.error.trim()})\n    ${b.code.split('\n').join('\n    ')}`);
      continue;
    }
    const qDefs = sorted(r.defs);
    if (JSON.stringify(qDefs) !== JSON.stringify(sorted(b.names))) {
      problems.push(`${where}: defines ${JSON.stringify(sorted(b.names))}, q says ${JSON.stringify(qDefs)}`);
    }
    // q lists every global name; keep those that resolve to a definition in this file
    const qUses = sorted(r.globals.flatMap((g) => model.resolve(g) || []).filter((id) => id !== b.id)
      .map((id) => model.blocks[id].names[0]));
    const ours = sorted(b.refs.filter((x) => x.via === 'name').map((x) => model.blocks[x.id].names[0]));
    if (JSON.stringify(qUses) !== JSON.stringify(ours)) {
      problems.push(`${where}: refers to ${JSON.stringify(ours)}, q says ${JSON.stringify(qUses)}`);
    }
  }
  return { checked: results.length, problems };
}

const q = findQ();

test('analysis agrees with q (KDB-X) on every block', { skip: q ? false : 'no licensed q found (see header of test/kdbx.test.js)' }, (t) => {
  const files = qFiles();
  if (!fs.existsSync(path.join(ROOT, '.corpus'))) t.diagnostic('corpus not fetched: run `npm run corpus` to include real-world q');
  const problems = [];
  let checked = 0;
  for (const file of files) {
    const res = compare(file, fs.readFileSync(file, 'utf8'), q);
    checked += res.checked;
    problems.push(...res.problems);
  }
  t.diagnostic(`q via ${q.kind}: ${checked} blocks in ${files.length} files checked`);
  assert.ok(checked > 0, 'nothing was checked');
  assert.equal(problems.length, 0, `${problems.length} disagreement(s) with q:\n\n${problems.join('\n\n')}`);
});
