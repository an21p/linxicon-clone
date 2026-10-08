#!/usr/bin/env node
'use strict';
// Usage: q-storyline <file.q> [--bottom-up] [--plain]
const fs = require('fs');
const path = require('path');
const { buildStory } = require('../src/story');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: q-storyline <file.q> [--bottom-up] [--plain]');
  process.exit(2);
}
const story = buildStory(fs.readFileSync(file, 'utf8'), {
  mode: args.includes('--bottom-up') ? 'bottom-up' : 'top-down',
  annotate: !args.includes('--plain'),
  fileName: path.basename(file),
});
process.stdout.write(story.text);
