# q Storyline

A VS Code extension that shows a kdb+/q script as a story. It splits the file
into top-level blocks, works out what each block is and what it depends on, and
reorders the blocks into a linked reading view: context first, then what the
script does.

The source file is never modified. The storyline is a read-only side view, and
every block in it links back to its original lines.

The extension doesn't come with its own q parser. It uses the parser from KX's
official language server, and its tests check the analysis against q itself
(KDB-X).

## Why

q scripts are written in the order the interpreter needs. Helpers come first
because a script runs top to bottom, so the thing the file actually does is
usually in the last few lines. A reader has to scan everything before reaching
the point, then jump back up to find the helpers.

Program-comprehension research supports reading a different way.

- **Top-down comprehension** (Brooks, 1983): experienced readers form a
  hypothesis about what a program does, then go looking for the parts that
  confirm it. Putting the entry point and main flow first gives them that
  hypothesis straight away.
- **The stepdown rule** (Martin, *Clean Code*): each function should be followed
  by the functions it calls, so the code reads like a narrative descending one
  level of abstraction at a time.
- **Literate programming** (Knuth, 1984): code should be presented in the order
  best for human understanding, not the order the compiler wants. q Storyline
  is a mechanical, zero-effort version of that idea.
- **Bottom-up comprehension** (Pennington, 1987): novices, and anyone in
  unfamiliar territory, build understanding from small pieces upward. So there
  is also a bottom-up mode.

Reordering helps most with files that are longer than a screen, that have a
clear "program" part, and that are read by someone new to them. For a flat
library of unrelated functions, the main value is the "Entry points" section,
which shows which functions are the public API.

## The storyline

**Top-down** (default):

| # | Section | Contents |
|---|---------|----------|
| 1 | Overview | the comments at the top of the file |
| 2 | Setup | `\l`, `\p`, `\c` and other system commands |
| 3 | Configuration | names bound to static values; unused ones are flagged |
| 4 | Data model | tables and schemas (`([] ...)`, `flip`, `xkey`, `.Q.en`) |
| 5 | Main flow | statements that run on load, in their original order. Each one is followed depth-first by the helper functions it uses (`↳`). |
| 6 | Event handlers | `.z.*` callbacks and their helpers |
| 7 | Entry points | functions nothing in the file calls, so they're invoked over IPC or from another script, or they're dead code |
| 8 | Other | functions reachable only through each other (mutual recursion) |
| 9 | Appendix | trailing comments, and anything after the end-of-script `\` |

**Bottom-up** uses the same context sections, then the building blocks
leaves-first, so every function appears after everything it uses. Event
handlers and the main flow come last.

Here is kdb-tick's `tick.q` in top-down order (outline only):

```
/ 3 · MAIN FLOW — what runs when the script loads, in order; ...
/ ▸ if[system"t"; · L35-39 · statement in .u · uses .u.ts
/ ↳ .u.ts · L33 · function in .u · helper of if[system"t"; · uses .u.endofday
/   ↳ .u.endofday · L32 · function in .u · helper of .u.ts · uses .u.ld
/     ↳ .u.ld · L29 · function in .u · helper of .u.endofday · also used by .u.tick
/ ▸ .u.tick[src;.z.x 1]; · L48 · statement · uses .u.tick
/ ↳ .u.tick · L30 · function in .u · helper of .u.tick[src;.z.x 1]; · uses .u.ld
```

Each `L35-39` is a link back to the source. To render the full example, run
`npm run example`.

## Using it

| Action | How |
|--------|-----|
| Open the storyline for a `.q` file | book icon in the editor title bar, or `Ctrl+Alt+S` / `Cmd+Alt+S` |
| Switch top-down / bottom-up | swap icon in the storyline's title bar (keeps your place) |
| Story → source | click an `L12-20` link, or `Ctrl+Alt+R` on any line |
| Source → story | `Ctrl+Alt+R` in the `.q` file, or *Reveal in Storyline* in the context menu |
| Outline | **q Storyline** panel in the Explorer: sections with helpers nested under their callers. Click to jump. |

The view updates as you edit the source. Settings:

- `qStoryline.defaultMode`: `top-down` or `bottom-up`
- `qStoryline.annotate`: turn the header lines on or off

The extension works with or without KX's own q extension installed.

There's also a CLI, available after `npm run build`:

```sh
node out/cli.js path/to/file.q [--bottom-up] [--plain]
```

## How it works

| Layer | Source | What it does |
|-------|--------|--------------|
| q parsing | [`vendor/kx-parser`](vendor/kx-parser), taken **unmodified** from [KxSystems/kx-vscode](https://github.com/KxSystems/kx-vscode) (Apache-2.0) | lexing (strings, symbols, temporal literals, `/ … \` block comments, end-of-script `\`); scopes; `\d` namespaces; global definitions; and, for every identifier, whether it is local or global |
| blocks | `src/model.ts` | which lines form a top-level statement (column 0 starts one, indented lines continue it), comments attached to blocks, and roles. It uses the KX tokens, so multi-line strings and block comments are handled for free. |
| storyline | `src/story.ts` | ordering, rendering, and the two-way line map |
| extension | `src/extension.ts` | virtual document, links, outline, and commands |

The extension adds three things on top of KX's parser:
- `.z.*` handler assignments: KX lexes `.z.pc` as a reserved word and doesn't
  record assignments to it.
- `` `f `` symbols that name a function count as references, for example in
  `value`f` and `@[`f;...]`.
- Table columns (`([] sym:...)`) and q-sql columns (`select price from t`) are
  excluded.

KX's `call` field isn't used. It marks the most recent definition before any
`{`, so after `cfg:get`:cfg` followed by `.z.ts:{...}`, `cfg` looked callable.

To update the vendored parser, run `npm run vendor`, after bumping `KX_COMMIT`
in `scripts/vendor-kx-parser.sh` if you want a newer upstream.

### Alternatives considered

- **KX language server parser** (chosen). It's maintained by KX, Apache-2.0,
  and depends only on `chevrotain`.
- **Talking to a running language server over LSP** (definition and reference
  requests). The storyline needs the whole-file graph at once, and one request
  per symbol is slow. It would also require the KX extension to be installed.
- **jshinonome's vscode-q / tree-sitter-q**. The source is no longer published,
  and the current repository is "all rights reserved".
- **q's own `parse`**. It's the most authoritative option, but it needs a
  licensed q at runtime. It's used as the test oracle instead.

## Testing

```sh
npm test            # build, then unit tests + extension smoke test (stubbed vscode API)
npm run typecheck
npm run corpus      # fetch real-world q (kdb-tick, kx-vscode q files) into .corpus/
npm run test:kdbx   # check the analysis against q itself
```

### Against q (KDB-X)

`test/kdbx.test.js` runs `test/kdbx/oracle.q` over every code block in
`examples/` and `.corpus/`, and fails on any disagreement. For each block, q
must agree that:

1. the block is a complete statement on its own (`parse`), so blocks split where
   q splits them
2. it defines exactly the names the analysis found (assignments in the parse
   tree)
3. it refers to exactly the file's globals the analysis found. These come from
   compiling the block inside a lambda with `value "{[] …}"`, which compiles but
   doesn't run it, then reading the lambda's globals list, recursing into
   nested lambdas.

Nothing from the scripts is executed.

The test needs a licensed q and skips itself otherwise. It looks for one in this
order:

1. `QSTORY_Q`, a q command
2. `q` on the PATH
3. KDB-X Python: `pip install pykx`, plus a license in `KDB_LICENSE_B64`. The
   free KDB-X Community Edition license from kx.com works.

CI runs it when the repository has a `KDB_LICENSE_B64` secret.

## Limitations

- Names built at runtime (``value "f",string n``) and dictionary dispatch aren't
  seen as references.
- References are per file. Calls into other loaded scripts aren't followed.
- The storyline is for reading. It isn't meant to be executed, because `\d`
  lines are left out (each block's namespace is shown in its header) and order
  matters for top-level statements.

## Development

Node 18+, VS Code 1.80+. The extension is bundled with esbuild into `out/`.

```sh
npm ci
npm run build       # or: npm test
npm run package     # .vsix via @vscode/vsce
```

To try it in VS Code, open this folder, run `npm run build`, and press F5
(*Run Extension*). This opens `examples/` in a development host.
