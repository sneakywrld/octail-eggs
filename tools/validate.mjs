#!/usr/bin/env node
/**
 * Validates every egg in the octail-eggs repository. Standalone: plain Node (20+), no dependencies, nothing from
 * the Octail panel. Run from the repository root:
 *
 *   node tools/validate.mjs [--forbid-upstream-images] [--strict] [--quiet] [--json | --github] [dir]
 *
 * Rules (each problem is reported with the file it is in; the exit code is 1 when there is any; warnings are listed
 * but only fail with --strict; --quiet leaves them out):
 *   - the egg format, from tools/egg-format.mjs: the very rules the Octail panel imports eggs with (published from
 *     the panel's shared/src/egg-format.js). Anything the panel refuses to import, and anything it imports with a
 *     warning (a part it ignores or renames: unknown variable rules, malformed x_octail features, …), is a problem.
 *   - this repository's own policy on top:
 *     - layout: eggs live at <category>/<slug>.json (lower-case slugs), JSON only, nothing egg-like elsewhere
 *     - uuid and author are set, uuids are unique across the repository, an install script with its container
 *     - meta.update_url, when it points into this repository, points at the egg's own file
 *     - SteamCMD installs (`steamcmd.sh` with `+app_update`) retry the download (`for steamcmd_try in 1 2 3; do`)
 *     - installs with the "fail the install when SteamCMD didn't download the server" check `exit 1` in it
 *     - no `http://` in install scripts (downloads over HTTPS only)
 *     - with --forbid-upstream-images: no ghcr.io/parkervcp, ghcr.io/pelican-eggs or ghcr.io/pterodactyl images
 *   - the lint rules of tools/egg-lint.mjs (errors are problems, warnings are warnings): images on octail-yolks with
 *     tags that exist (tools/yolks-tags.txt, when present), a stop command, a ready line, the startup line's
 *     variables defined, no unused variables, defaults that pass their own rules, port variables passed to the game,
 *     TLS checks on and checksums checked where the source publishes them. Each finding names its rule.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EGG_FORMATS, eggFormatProblems, eggImages } from './egg-format.mjs';
import { eggLint } from './egg-lint.mjs';

export const RAW_BASE = 'https://raw.githubusercontent.com/sneakywrld/octail-eggs/main/';
export const FORMATS = EGG_FORMATS;
export const UPSTREAM_IMAGE = /^(?:docker\.io\/)?ghcr\.io\/(parkervcp|pelican-eggs|pterodactyl)\//i;
export const STEAMCMD_FAIL_MARKER = "## Octail: fail the install when SteamCMD didn't download the server";
const SKIP_DIRS = new Set(['.git', '.github', 'tools', 'node_modules']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** This repository's policy for one egg (on top of the format), as messages. */
export function policyProblems(egg, path, { forbidUpstreamImages = false } = {}) {
  if (!isObj(egg)) return [];
  const p = [];
  if (!UUID.test(str(egg.uuid))) p.push('uuid is missing or not a uuid');
  if (!str(egg.author).trim()) p.push('author is missing');
  const url = egg.meta?.update_url;
  if (typeof url === 'string' && url.startsWith(RAW_BASE) && url !== RAW_BASE + path)
    p.push(`meta.update_url points at ${url.slice(RAW_BASE.length)}, not at this file`);

  const inst = egg.scripts?.installation;
  if (!isObj(inst)) p.push('scripts.installation is missing');
  const script = str(inst?.script);
  if (inst && !script.trim()) p.push('the install script is empty');
  if (inst && !script.trim() && !str(inst.container).trim()) p.push('the install script has no container image');
  if (
    script.includes('steamcmd.sh') &&
    script.includes('+app_update') &&
    !/for (steamcmd_try|attempt) in 1 2 3; do/.test(script)
  )
    p.push('SteamCMD install without the retry loop (for steamcmd_try in 1 2 3; do …)');
  const marker = script.indexOf(STEAMCMD_FAIL_MARKER);
  if (marker !== -1) {
    const block = script.slice(
      marker,
      script.indexOf('\nfi', marker) === -1 ? undefined : script.indexOf('\nfi', marker),
    );
    if (!/\bexit 1\b/.test(block)) p.push('the "SteamCMD didn\'t download the server" check doesn\'t exit 1');
  }
  if (/http:\/\/(?!(localhost|127\.0\.0\.1)[:/])/.test(script)) p.push('the install script downloads over http://');

  if (forbidUpstreamImages) {
    for (const ref of [...Object.values(eggImages(egg)), str(inst?.container)])
      if (UPSTREAM_IMAGE.test(String(ref)))
        p.push(`uses the upstream image ${ref} (use ghcr.io/sneakywrld/octail-yolks)`);
  }
  return p;
}

/** Problems with one parsed egg document. `path` is its repository path ("minecraft/paper.json"). */
export function eggProblems(egg, path, { forbidUpstreamImages = false } = {}) {
  const { errors, warnings } = eggFormatProblems(egg);
  // A message both lists give is reported once.
  return [...new Set([...errors, ...policyProblems(egg, path, { forbidUpstreamImages }), ...warnings])];
}

/**
 * The lint findings (tools/egg-lint.mjs) for one parsed egg as { errors, warnings }, messages naming their rule.
 * `yolksTags` (a Set) is the list of octail-yolks tags, when known.
 */
export function eggLintProblems(egg, { yolksTags = null } = {}) {
  const findings = eggLint(egg, { yolksTags });
  const of = (level) => findings.filter((f) => f.level === level).map((f) => `${f.message} [${f.rule}]`);
  return { errors: of('error'), warnings: of('warning') };
}

/**
 * The octail-yolks tags (a Set), or null when no list is found: `tools/yolks-tags.txt` (one tag per line, written by
 * the generator), else `yolks/images.json` when this runs inside the Octail monorepo.
 */
export function loadYolksTags(root) {
  const file = join(root, 'tools/yolks-tags.txt');
  if (existsSync(file))
    return new Set(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean),
    );
  // In the monorepo this file is octail/scripts/eggs/repo-files/tools/, next to scripts/eggs/build-repo.mjs.
  const here = dirname(fileURLToPath(import.meta.url));
  const images = resolve(here, '../../../../../yolks/images.json');
  if (existsSync(resolve(here, '../../build-repo.mjs')) && existsSync(images)) {
    const doc = JSON.parse(readFileSync(images, 'utf8'));
    if (Array.isArray(doc?.images)) return new Set(doc.images.map((i) => String(i.tag)));
  }
  return null;
}

function walk(dir, root, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (dir === root && SKIP_DIRS.has(name)) continue;
      walk(full, root, out);
    } else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/**
 * Validates the repository at `root`. Returns { eggs: number, problems: [{ file, problem }], warnings: [{ file,
 * problem }] }; with `strict` the warnings are problems too. `yolksTags` defaults to loadYolksTags(root).
 */
export function validateRepo(root, { forbidUpstreamImages = false, strict = false, yolksTags } = {}) {
  const problems = [];
  const warnings = [];
  const add = (file, problem) => problems.push({ file, problem });
  const tags = yolksTags === undefined ? loadYolksTags(root) : yolksTags;
  const uuids = new Map();
  let eggs = 0;
  for (const file of walk(root, root, [])) {
    if (/\.ya?ml$/i.test(file)) {
      add(file, 'eggs in this repository are JSON: convert YAML eggs');
      continue;
    }
    if (!file.endsWith('.json') || file === 'stats.json') continue; // stats.json: the README's numbers, not an egg
    const parts = file.split('/');
    if (parts.length !== 2 || !SLUG.test(parts[0]) || !SLUG.test(parts[1].replace(/\.json$/, ''))) {
      add(file, 'eggs belong at <category>/<slug>.json with lower-case slugs');
      continue;
    }
    eggs++;
    let egg;
    try {
      egg = JSON.parse(readFileSync(join(root, file), 'utf8'));
    } catch (err) {
      add(file, `not valid JSON: ${err.message}`);
      continue;
    }
    const lint = eggLintProblems(egg, { yolksTags: tags });
    for (const problem of new Set([...eggProblems(egg, file, { forbidUpstreamImages }), ...lint.errors]))
      add(file, problem);
    for (const problem of lint.warnings) (strict ? problems : warnings).push({ file, problem });
    const uuid = str(egg?.uuid).toLowerCase();
    if (uuid) {
      if (uuids.has(uuid)) add(file, `uuid ${uuid} is also used by ${uuids.get(uuid)}`);
      else uuids.set(uuid, file);
    }
  }
  if (eggs === 0) add('.', 'no eggs found');
  return { eggs, problems, warnings };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const forbidUpstreamImages = args.includes('--forbid-upstream-images');
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const quiet = args.includes('--quiet');
  const dir = args.find((a) => !a.startsWith('--')) ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { eggs, problems, warnings } = validateRepo(resolve(dir), { forbidUpstreamImages, strict });
  if (json) console.log(JSON.stringify({ eggs, problems, warnings }, null, 2));
  else if (args.includes('--github')) {
    // GitHub Actions annotations: each finding shows on the file in the run and the pull request.
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    for (const { file, problem } of problems) console.log(`::error file=${esc(file)}::${esc(problem)}`);
    for (const { file, problem } of warnings) console.log(`::warning file=${esc(file)}::${esc(problem)}`);
    console.log(`${eggs} eggs: ${problems.length} problem(s), ${warnings.length} warning(s).`);
  } else {
    for (const { file, problem } of problems) console.log(`${file}: ${problem}`);
    if (!quiet) for (const { file, problem } of warnings) console.log(`${file}: warning: ${problem}`);
    const note = warnings.length ? ` (${warnings.length} warning(s))` : '';
    console.log(
      problems.length ? `\n${problems.length} problem(s) in ${eggs} eggs${note}.` : `${eggs} eggs, all valid${note}.`,
    );
  }
  process.exitCode = problems.length ? 1 : 0;
}
