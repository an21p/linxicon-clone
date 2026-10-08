# q Storyline

A VS Code extension that shows a kdb+/q script as a story. It splits the file
into top-level blocks, works out what each block is and what it depends on, and
reorders the blocks into a linked reading view: context first, then what the
script does.

The source file is never modified. The storyline is a read-only side view, and
every block in it links back to its original lines.

## Why

q scripts are written in the order the interpreter needs. Helpers come first
because a script runs top to bottom, so the thing the file actually does is
usually in the last five lines. A reader has to scan everything before reaching
the point, then jump back up to find the helpers.

Program-comprehension research supports reading a different way.

- **Top-down comprehension** (Brooks, 1983): experienced readers form a
  hypothesis about what the program does, then go looking for the parts that
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

Reordering is not a silver bullet. It helps most with files that are larger
than one screen, that have a clear "program" part, and that are read by someone
who doesn't know them yet. It helps least with files that are already a flat
library of unrelated functions, though the "Entry points" section still shows
which functions are the public API.

## The storyline

**Top-down** (default):

| # | Section | Contents |
|---|---------|----------|
| 1 | Overview | the file's opening comment |
| 2 | Setup | `\l`, `\p`, `\c` and other system commands |
| 3 | Configuration | names bound to literal values; unused ones are flagged |
| 4 | Data model | tables and schemas (`([] ...)`, `flip`, `xkey`, `.Q.en`) |
| 5 | Main flow | statements that run on load, in their original order. Each one is followed depth-first by the helper functions it uses (`↳`), in first-use order. |
| 6 | Event handlers | `.z.*` callbacks and their helpers |
| 7 | Entry points | functions nothing in the file calls, so they're invoked over IPC or from another script, or they're dead code |
| 8 | Other | functions reachable only through each other (mutual recursion) |
| 9 | Appendix | anything after the end-of-script `\` |

**Bottom-up** uses the same context sections, then the building blocks
leaves-first, so every function appears after everything it uses. Event
handlers and the main flow come last.

Each block gets an annotation header:

```q
/ ↳ connect · L40-43 · function · helper of h · uses retry, log
connect:{[port]
  h:retry[5;2000;hopen;port];
  if[`err~first h; log[`error;"cannot reach tickerplant"]; exit 1];
  h }
```

`L40-43` is a link back to the source. To see the whole thing, run
`npm run example`, which renders [`examples/rdb.q`](examples/rdb.q).

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

The extension doesn't need the official KX q extension, but it works alongside
it. The storyline has its own small grammar, so its section headers and
annotations stand out.

There's also a CLI:

```sh
node bin/q-storyline.js path/to/file.q [--bottom-up] [--plain]
```

## How it works

1. **Split** (`src/parser.js`). A statement starts in column 0, and indented
   lines continue it, including across blank lines. Comments directly above a
   block belong to it. A `/` … `\` pair is a block comment, a lone `\` ends the
   script, and `\d .ns` switches the namespace for the blocks that follow.
2. **Analyse** (`src/analyze.js`). Each block is tokenized (strings, symbols,
   numbers and comments are handled), then the parser works out:
   - **Definitions:** `name:`, `name::`, `` `name set ``, including several on one
     line separated by `;`, qualified with the active namespace.
   - **References:** identifiers that resolve to a definition in the file. Lambda
     parameters, `x`/`y`/`z` and local assignments are excluded. Namespace
     lookup falls back to the root, and `` `sym `` counts as a reference only
     when it names a function (as in `value`, `.z.ts`, `@[`f;...]`).
   - **Role:** function, handler, table, constant, *computed* (the value comes
     from running code or I/O such as `get` or `hopen`, so it's a program step,
     not configuration), statement, or system.
3. **Order and render** (`src/story.js`) uses the rules above, and keeps a line
   map in both directions for navigation.

### Limitations

- This is a heuristic parser, not a q interpreter. Names built at runtime
  (``value "f",string n``) and dictionary-style dispatch aren't seen as
  references.
- A q-sql column that shares a name with a global (`select price from t` when
  there is also a global `price`) is counted as a reference.
- References are per file. Calls into other loaded scripts aren't followed.
- The storyline is for reading. It isn't meant to be executed, because `\d`
  lines are left out (each block's namespace is shown in its header) and order
  matters for top-level statements.

## Development

No dependencies. Node 18+ and VS Code 1.80+.

```sh
npm test              # parser, ordering and an extension smoke test against a stubbed vscode API
npm run example       # print the storyline for examples/rdb.q
npm run package       # build a .vsix (npx @vscode/vsce)
```

To try it in VS Code, open this folder and press F5 (Run Extension), or install
the `.vsix` with *Extensions: Install from VSIX…*.
