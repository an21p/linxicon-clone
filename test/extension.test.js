'use strict';
// Smoke test (run `npm run build` first): runs activate() and the commands against a minimal stand-in for the
// `vscode` module, to catch wiring errors without launching an editor.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'examples', 'rdb.q');
const sourceText = fs.readFileSync(sourcePath, 'utf8');

function fakeVscode() {
  const commands = new Map();
  const providers = {};
  const shown = [];
  class Uri {
    constructor(p) { Object.assign(this, { scheme: 'file', path: '', query: '', fragment: '' }, p); }
    static from(p) { return new Uri(p); }
    static file(p) { return new Uri({ path: p }); }
    static parse(s) {
      const m = /^([\w-]+):([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(s);
      return new Uri({ scheme: m[1], path: m[2].replace(/^\/\//, ''), query: m[3] || '', fragment: m[4] || '' });
    }
    toString() { return `${this.scheme}:${this.scheme === 'file' ? '//' : ''}${this.path}${this.query ? '?' + this.query : ''}${this.fragment ? '#' + this.fragment : ''}`; }
  }
  const docFor = (uri, text, languageId) => {
    const lines = text.split('\n');
    return {
      uri, languageId, fileName: uri.path, lineCount: lines.length,
      getText: () => text, lineAt: (i) => ({ text: lines[i] }),
    };
  };
  const source = docFor(Uri.file(sourcePath), sourceText, 'q');
  const docs = [source];
  class Position { constructor(line, character) { Object.assign(this, { line, character }); } }
  class Range { constructor(a, b, c, d) { this.start = new Position(a, b); this.end = new Position(c, d); } }
  class Selection extends Range { constructor(a, b) { super(a.line, a.character, b.line, b.character); this.active = a; } }
  class EventEmitter { constructor() { this.listeners = []; this.event = (l) => this.listeners.push(l); } fire(e) { this.listeners.forEach((l) => l(e)); } }
  const editorFor = (document) => ({
    document, viewColumn: 1, selection: new Selection(new Position(0, 0), new Position(0, 0)),
    revealRange() {}, setDecorations() {},
  });
  const window = {
    activeTextEditor: editorFor(source),
    visibleTextEditors: [],
    createTextEditorDecorationType: () => ({}),
    showInformationMessage() {},
    registerTreeDataProvider: (id, p) => { providers.tree = p; return { dispose() {} }; },
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    async showTextDocument(doc) {
      const editor = editorFor(doc);
      window.activeTextEditor = editor;
      shown.push(editor);
      return editor;
    },
  };
  const vscode = {
    Uri, Position, Range, Selection, EventEmitter,
    ViewColumn: { Beside: -2 },
    TextEditorRevealType: { AtTop: 3, InCenterIfOutsideViewport: 2 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    TreeItem: class { constructor(label, state) { Object.assign(this, { label, collapsibleState: state }); } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    MarkdownString: class { constructor(v) { this.value = v; } },
    DocumentLink: class { constructor(range, target) { Object.assign(this, { range, target }); } },
    window,
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; } },
    languages: {
      registerDocumentLinkProvider: (sel, p) => { providers.links = p; return { dispose() {} }; },
      async setTextDocumentLanguage(doc, id) { doc.languageId = id; return doc; },
    },
    workspace: {
      textDocuments: docs,
      getConfiguration: () => ({ get: (k, d) => d }),
      registerTextDocumentContentProvider: (scheme, p) => { providers.content = p; return { dispose() {} }; },
      onDidChangeTextDocument: () => ({ dispose() {} }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      async openTextDocument(uri) {
        const key = uri.toString();
        let doc = docs.find((d) => d.uri.toString() === key);
        if (!doc) {
          doc = docFor(uri, await providers.content.provideTextDocumentContent(uri), 'plaintext');
          docs.push(doc);
        }
        return doc;
      },
    },
  };
  return { vscode, commands, providers, shown, source };
}

test('extension activates, opens a linked story, and navigates both ways', async () => {
  const fake = fakeVscode();
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? fake.vscode : load.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve('../out/extension.js')];
    const ext = require('../out/extension.js');
    ext.activate({ subscriptions: [] });
    for (const id of ['open', 'openBottomUp', 'toggleMode', 'goToSource', 'revealInStory', 'revealSource']) {
      assert.ok(fake.commands.has(`qStoryline.${id}`), id);
    }

    // outline tree: sections, nested helpers, clicking reveals source
    const tree = fake.providers.tree;
    await new Promise((r) => setImmediate(r));
    const sections = tree.getChildren();
    assert.equal(tree.getTreeItem(sections[0]).label, '1 · Overview');
    const main = sections.find((s) => s.section.key === 'main');
    const h = tree.getChildren(main)[0];
    assert.equal(tree.getTreeItem(h).label, 'h');
    assert.deepEqual(tree.getChildren(h).map((n) => tree.getTreeItem(n).label), ['connect']);

    // open the story: virtual doc in the q-storyline language, with links back to source
    await fake.commands.get('qStoryline.open')();
    const storyEditor = fake.shown.at(-1);
    assert.equal(storyEditor.document.uri.scheme, 'q-storyline');
    assert.equal(storyEditor.document.languageId, 'q-storyline');
    assert.match(storyEditor.document.getText(), /MAIN FLOW/);
    const links = fake.providers.links.provideDocumentLinks(storyEditor.document);
    assert.ok(links.length > 10);
    assert.match(links[0].target.toString(), /^command:qStoryline\.revealSource\?/);

    // story -> source: put the cursor on `connect:{[port]` and jump
    const storyLines = storyEditor.document.getText().split('\n');
    const connectLine = storyLines.indexOf('connect:{[port]');
    storyEditor.selection = new fake.vscode.Selection(new fake.vscode.Position(connectLine, 0), new fake.vscode.Position(connectLine, 0));
    await fake.commands.get('qStoryline.goToSource')();
    const back = fake.shown.at(-1);
    assert.equal(back.document, fake.source);
    assert.equal(fake.source.getText().split('\n')[back.selection.active.line], 'connect:{[port]');

    // source -> story
    await fake.commands.get('qStoryline.revealInStory')();
    const again = fake.shown.at(-1);
    assert.equal(again.document.getText().split('\n')[again.selection.active.line], 'connect:{[port]');

    // switch modes and stay on the same block
    await fake.commands.get('qStoryline.toggleMode')();
    const bottomUp = fake.shown.at(-1);
    assert.equal(bottomUp.document.uri.query, 'bottom-up');
    assert.equal(bottomUp.document.getText().split('\n')[bottomUp.selection.active.line], 'connect:{[port]');
  } finally {
    Module._load = load;
  }
});
