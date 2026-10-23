#!/usr/bin/env node
/**
 * The formatting every egg in the octail-eggs repository has: the generator writes each file as
 * `JSON.stringify(egg, null, 2)` plus a final newline (UTF-8, no BOM, LF line ends), so a diff shows only what changed.
 * Standalone: plain Node (20+), no dependencies. Run from the repository root:
 *
 *   node tools/format.mjs --check [dir]    lists the eggs that aren't formatted, exit code 1 when there is any
 *   node tools/format.mjs --write [dir]    rewrites them
 *
 * Files that aren't valid JSON are left to tools/validate.mjs.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['.git', '.github', 'tools', 'node_modules']);

/** An egg document as its file should read. */
export const formatEgg = (egg) => `${JSON.stringify(egg, null, 2)}\n`;

/** Why `text` isn't formatted, or null when it is (or doesn't parse: validate.mjs reports that). */
export function formatProblem(text) {
  let egg;
  try {
    egg = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (text.startsWith('\uFEFF')) return 'starts with a byte order mark';
  if (text.includes('\r')) return 'has CRLF line ends';
  if (text !== formatEgg(egg)) return 'is not formatted (2-space JSON with a final newline)';
  return null;
}

function walk(dir, root, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!(dir === root && SKIP_DIRS.has(name))) walk(full, root, out);
    } else if (name.endsWith('.json')) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** Checks (or with `write`, fixes) every egg under `root`. Returns [{ file, problem }] (what was found). */
export function formatRepo(root, { write = false } = {}) {
  const found = [];
  for (const file of walk(root, root, [])) {
    if (file.split('/').length !== 2) continue; // eggs are <category>/<slug>.json
    const text = readFileSync(join(root, file), 'utf8');
    const problem = formatProblem(text);
    if (!problem) continue;
    found.push({ file, problem });
    if (write) writeFileSync(join(root, file), formatEgg(JSON.parse(text.replace(/^\uFEFF/, ''))));
  }
  return found;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  if (!write && !args.includes('--check')) {
    console.error('usage: node tools/format.mjs --check|--write [dir]');
    process.exit(2);
  }
  const dir = args.find((a) => !a.startsWith('--')) ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const found = formatRepo(resolve(dir), { write });
  for (const { file, problem } of found) console.log(`${file}: ${problem}${write ? ' (rewritten)' : ''}`);
  if (!found.length) console.log('Every egg is formatted.');
  else if (!write) console.log(`\n${found.length} egg(s) to format: run node tools/format.mjs --write`);
  process.exitCode = found.length && !write ? 1 : 0;
}
