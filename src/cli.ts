// Usage: q-storyline <file.q> [--bottom-up] [--plain]
import { readFileSync } from "fs";
import { basename } from "path";
import { buildStory } from "./story";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: q-storyline <file.q> [--bottom-up] [--plain]");
  process.exit(2);
}
const story = buildStory(readFileSync(file, "utf8"), {
  mode: args.includes("--bottom-up") ? "bottom-up" : "top-down",
  annotate: !args.includes("--plain"),
  fileName: basename(file),
});
process.stdout.write(story.text);
