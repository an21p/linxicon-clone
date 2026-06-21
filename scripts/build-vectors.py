#!/usr/bin/env python3
"""Build the curated vocabulary + quantized Numberbatch assets.

Run with the prepared venv:
    /tmp/linx-venv/bin/python scripts/build-vectors.py

Inputs (reused, never re-downloaded):
    /tmp/numberbatch-en.txt.gz   ConceptNet Numberbatch 19.08 EN, 300-dim, word2vec text
Outputs:
    src/lib/words/dictionary.json   curated word list (sorted) -- the playable set
    public/numberbatch.bin          int8 matrix, row-major N x DIM
    public/numberbatch-index.json   {"dim": DIM, "words": [...]}, row i = words[i]
"""
import gzip
import json
import os
import sys

import numpy as np
import wordfreq

# --- named constants (keep QUANT_SCALE in sync with src/lib/numberbatch.ts) ---
TOP_N = 40000
QUANT_SCALE = 127
DIM = 300

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GZ = "/tmp/numberbatch-en.txt.gz"
DICT_PATH = os.path.join(ROOT, "src", "lib", "words", "dictionary.json")
BIN_PATH = os.path.join(ROOT, "public", "numberbatch.bin")
INDEX_PATH = os.path.join(ROOT, "public", "numberbatch-index.json")
NOUNS_PATH = os.path.join(ROOT, "src", "lib", "words", "nouns.ts")

def load_current_dictionary():
    with open(DICT_PATH, encoding="utf-8") as f:
        return set(json.load(f))

def load_nouns():
    # crude extract of single-quoted tokens from nouns.ts, for the drop report
    import re
    with open(NOUNS_PATH, encoding="utf-8") as f:
        body = f.read()
    return [m for m in re.findall(r"'([a-z][a-z'-]*)'", body)]

def main():
    top = set(wordfreq.top_n_list("en", TOP_N))
    current = load_current_dictionary()
    allow = top & current  # candidate words; intersect Numberbatch during the stream

    rows = {}   # word -> np.float32[DIM]
    seen_nb = 0
    with gzip.open(GZ, "rt", encoding="utf-8") as f:
        header = f.readline().split()
        assert int(header[1]) == DIM, f"unexpected dim {header[1]}"
        for line in f:
            sp = line.rstrip("\n").split(" ")
            word = sp[0]
            seen_nb += 1
            if word not in allow:
                continue
            vec = np.asarray(sp[1:1 + DIM], dtype=np.float32)
            if vec.shape[0] != DIM:
                continue
            rows[word] = vec

    words = sorted(rows)               # deterministic row order
    n = len(words)
    if n == 0:
        sys.exit("ERROR: empty curated vocabulary")

    mat = np.zeros((n, DIM), dtype=np.int8)
    for i, w in enumerate(words):
        v = rows[w]
        norm = np.linalg.norm(v)
        if norm > 0:
            v = v / norm
        q = np.clip(np.round(v * QUANT_SCALE), -QUANT_SCALE, QUANT_SCALE)
        mat[i] = q.astype(np.int8)

    # --- write assets ---
    with open(DICT_PATH, "w", encoding="utf-8") as f:
        json.dump(words, f)
    mat.tofile(BIN_PATH)
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump({"dim": DIM, "words": words}, f)

    # --- report ---
    dropped_nouns = [w for w in load_nouns() if w not in rows]
    bin_bytes = os.path.getsize(BIN_PATH)
    idx_bytes = os.path.getsize(INDEX_PATH)
    print(f"TOP_N                = {TOP_N}")
    print(f"numberbatch lines    = {seen_nb}")
    print(f"curated vocab size   = {n}")
    print(f"numberbatch.bin      = {bin_bytes} bytes ({bin_bytes/1e6:.2f} MB)")
    print(f"numberbatch-index    = {idx_bytes} bytes ({idx_bytes/1e6:.2f} MB)")
    print(f"dropped nouns ({len(dropped_nouns)}): {dropped_nouns}")

if __name__ == "__main__":
    main()
