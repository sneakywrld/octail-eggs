#!/usr/bin/env node
/**
 * Validates every egg in the octail-eggs repository. Standalone: plain Node (20+), no dependencies, nothing from
 * the Octail panel. Run from the repository root:
 *
 *   node tools/validate.mjs [--forbid-upstream-images] [--json] [dir]
 *
 * Rules (each problem is reported with the file it is in; the exit code is 1 when there is any):
 *   - layout: eggs live at <category>/<slug>.json (lower-case slugs), JSON only, nothing egg-like elsewhere
 *   - the file parses, and has the required fields: meta.version (PTDL_v1/v2, PLCN_v1–v3), name, uuid, author,
 *     a startup command, config, an install script with its container, variables
 *   - docker_images is a non-empty object of label → image; uuids are unique across the repository
 *   - meta.update_url, when it points into this repository, points at the egg's own file
 *   - SteamCMD installs (`steamcmd.sh` with `+app_update`) retry the download (`for steamcmd_try in 1 2 3; do`)
 *   - installs with the "fail the install when SteamCMD didn't download the server" check `exit 1` in it
 *   - no `http://` in install scripts (downloads over HTTPS only)
 *   - variables: valid and unique env names, booleans for the flags, rules that parse (known Laravel rules,
 *     regexes that compile, numeric arguments where needed)
 *   - x_octail: an object with known keys, a category string, and well-formed features (port variables that
 *     exist, RCON type and variables, sleep mode, resources, install sandbox, port readiness, …)
 *   - with --forbid-upstream-images: no ghcr.io/parkervcp, ghcr.io/pelican-eggs or ghcr.io/pterodactyl images
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAW_BASE = 'https://raw.githubusercontent.com/sneakywrld/octail-eggs/main/';
export const FORMATS = ['PTDL_v1', 'PTDL_v2', 'PLCN_v1', 'PLCN_v2', 'PLCN_v3'];
export const UPSTREAM_IMAGE = /^(?:docker\.io\/)?ghcr\.io\/(parkervcp|pelican-eggs|pterodactyl)\//i;
export const STEAMCMD_FAIL_MARKER = "## Octail: fail the install when SteamCMD didn't download the server";
const SKIP_DIRS = new Set(['.git', '.github', 'tools', 'node_modules']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Laravel rules the panel understands; anything else is ignored by the panel, which usually hides a typo.
const RULES_PLAIN = new Set([
  'required',
  'nullable',
  'sometimes',
  'present',
  'string',
  'integer',
  'numeric',
  'boolean',
  'alpha',
  'alpha_num',
  'alpha_dash',
  'url',
  'ip',
]);
const RULES_NUMBER = new Set(['min', 'max', 'size', 'digits', 'gt', 'gte', 'lt', 'lte']);
const RULES_TWO_NUMBERS = new Set(['between', 'digits_between']);
const RULES_LIST = new Set(['in', 'not_in']);
const RULES_REGEX = new Set(['regex', 'not_regex']);

const X_OCTAIL_KEYS = new Set(['category', 'features', 'pull_policy']);
const SLEEP_MODES = ['minecraft_java', 'minecraft_bedrock', 'tcp', 'udp'];
const RCON_TYPES = ['source', 'webrcon', 'satisfactory', 'minecraft'];
const PORT_SPEC = /^primary\s*\+\s*\d+$/;
const READY_PROTOS = ['udp', 'tcp', 'any'];

/** Splits "required|regex:/^(a|b)$/" on "|" but keeps a regex whole when its pattern contains "|". */
export function splitRules(rules) {
  if (Array.isArray(rules)) return rules.map(String).filter(Boolean);
  if (rules == null || rules === '') return [];
  if (typeof rules === 'object' && Object.keys(rules).length === 0) return []; // PHP's empty array exported as {}
  const out = [];
  let pending = null;
  for (const part of String(rules).split('|')) {
    if (pending !== null) {
      pending += `|${part}`;
      if (regexComplete(pending)) {
        out.push(pending);
        pending = null;
      }
      continue;
    }
    if (/^(not_)?regex:/.test(part) && !regexComplete(part)) pending = part;
    else if (part) out.push(part);
  }
  if (pending !== null) out.push(pending);
  return out;
}
function regexComplete(rule) {
  const body = rule.replace(/^(not_)?regex:/, '');
  if (body.length < 2) return false;
  const d = body[0];
  return new RegExp(`^\\${d}[\\s\\S]*\\${d}[a-zA-Z]*$`).test(body);
}

/** A PHP-delimited pattern (`/…/i`) as a JS RegExp, or null when it doesn't compile. */
export function phpRegex(pattern) {
  const d = pattern[0];
  const end = pattern.lastIndexOf(d);
  if (!d || /[a-zA-Z0-9\\\s]/.test(d) || end <= 0) return null;
  const flags = pattern
    .slice(end + 1)
    .split('')
    .filter((f) => 'imsu'.includes(f))
    .join('');
  try {
    return new RegExp(pattern.slice(1, end), flags);
  } catch {
    return null;
  }
}

/** Problems with one rule list, as strings. */
export function ruleProblems(rules) {
  if (rules != null && typeof rules !== 'string' && !Array.isArray(rules)) {
    if (typeof rules !== 'object' || Object.keys(rules).length > 0) return ['rules must be a string or a list'];
  }
  const problems = [];
  for (const rule of splitRules(rules)) {
    const i = rule.indexOf(':');
    const name = i === -1 ? rule : rule.slice(0, i);
    const arg = i === -1 ? '' : rule.slice(i + 1);
    const isNum = (s) => s.trim() !== '' && Number.isFinite(Number(s));
    if (RULES_PLAIN.has(name)) continue;
    if (RULES_NUMBER.has(name)) {
      if (!isNum(arg)) problems.push(`rule "${rule}" needs a number`);
    } else if (RULES_TWO_NUMBERS.has(name)) {
      const parts = arg.split(',');
      if (parts.length !== 2 || !parts.every(isNum)) problems.push(`rule "${rule}" needs two numbers`);
      else if (Number(parts[0]) > Number(parts[1])) problems.push(`rule "${rule}" has its bounds the wrong way round`);
    } else if (RULES_LIST.has(name)) {
      if (arg === '') problems.push(`rule "${rule}" needs a list of values`);
    } else if (RULES_REGEX.has(name)) {
      if (!phpRegex(arg)) problems.push(`rule "${rule}" has a pattern that doesn't compile`);
    } else problems.push(`unknown rule "${rule}"`);
  }
  return problems;
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** Problems with x_octail (shape only: the panel decides what the values do). */
export function xOctailProblems(x, envNames) {
  if (x === undefined) return [];
  if (!isObj(x)) return ['x_octail must be an object'];
  const p = [];
  for (const k of Object.keys(x)) if (!X_OCTAIL_KEYS.has(k)) p.push(`x_octail has an unknown key "${k}"`);
  if (x.category !== undefined && (typeof x.category !== 'string' || !x.category.trim() || x.category.length > 64))
    p.push('x_octail.category must be a non-empty string of at most 64 characters');
  if (x.pull_policy !== undefined && !['if_missing', 'always'].includes(x.pull_policy))
    p.push('x_octail.pull_policy must be "if_missing" or "always"');
  if (x.features === undefined) return p;
  if (!isObj(x.features)) return [...p, 'x_octail.features must be an object'];
  const f = x.features;
  const hasVar = (name) => envNames.has(name) || ['SERVER_PORT', 'SERVER_IP'].includes(name);
  if (f.port_vars !== undefined) {
    if (!isObj(f.port_vars)) p.push('x_octail.features.port_vars must be an object');
    else
      for (const [name, spec] of Object.entries(f.port_vars)) {
        if (!envNames.has(name)) p.push(`port_vars: ${name} is not a variable of the egg`);
        if (!PORT_SPEC.test(String(spec))) p.push(`port_vars: ${name} must be "primary+N", not "${spec}"`);
      }
  }
  if (f.fixed_ports !== undefined) {
    if (!isObj(f.fixed_ports)) p.push('x_octail.features.fixed_ports must be an object');
    else
      for (const [name, spec] of Object.entries(f.fixed_ports))
        if (!PORT_SPEC.test(String(spec)) && !/^\d+$/.test(String(spec)))
          p.push(`fixed_ports: "${name}" must be "primary+N" or a port number`);
  }
  if (f.rcon !== undefined && f.rcon !== false) {
    if (!isObj(f.rcon) || !RCON_TYPES.includes(f.rcon.type))
      p.push(`x_octail.features.rcon needs a type (${RCON_TYPES.join(', ')})`);
    else
      for (const k of ['port_var', 'password_var'])
        if (f.rcon[k] !== undefined && !hasVar(f.rcon[k]))
          p.push(`rcon.${k}: ${f.rcon[k]} is not a variable of the egg`);
  }
  if (f.player_query !== undefined && f.player_query !== false) {
    const q = f.player_query;
    if (typeof q === 'string') {
      if (q !== 'a2s') p.push('x_octail.features.player_query must be "a2s" or { type, port_var }');
    } else if (!isObj(q) || q.type !== 'a2s')
      p.push('x_octail.features.player_query must be "a2s" or { type, port_var }');
    else if (q.port_var !== undefined && !hasVar(q.port_var))
      p.push(`player_query.port_var: ${q.port_var} is not a variable of the egg`);
  }
  if (f.sleep !== undefined && f.sleep !== false && f.sleep !== true) {
    const mode = typeof f.sleep === 'string' ? f.sleep : isObj(f.sleep) ? f.sleep.mode : null;
    if (!SLEEP_MODES.includes(mode)) p.push(`x_octail.features.sleep mode must be one of ${SLEEP_MODES.join(', ')}`);
  }
  if (f.resources !== undefined) {
    if (!isObj(f.resources)) p.push('x_octail.features.resources must be an object');
    else
      for (const [k, v] of Object.entries(f.resources))
        if (!Number.isInteger(v) || v <= 0) p.push(`resources.${k} must be a positive whole number`);
  }
  if (f.install_sandbox !== undefined) {
    const s = f.install_sandbox;
    if (!isObj(s)) p.push('x_octail.features.install_sandbox must be an object');
    else {
      if (s.network !== undefined && typeof s.network !== 'string') p.push('install_sandbox.network must be a string');
      if (s.timeout_s !== undefined && (!Number.isInteger(s.timeout_s) || s.timeout_s < 0))
        p.push('install_sandbox.timeout_s must be a whole number ≥ 0');
    }
  }
  if (
    f.crash_files !== undefined &&
    (!Array.isArray(f.crash_files) || !f.crash_files.every((c) => typeof c === 'string'))
  )
    p.push('x_octail.features.crash_files must be a list of paths');
  for (const k of ['no_console_input', 'tty_answers', 'strip_ansi', 'thunderstore'])
    if (f[k] !== undefined && typeof f[k] !== 'boolean') p.push(`x_octail.features.${k} must be true or false`);
  if (f.broadcast_command !== undefined && typeof f.broadcast_command !== 'string')
    p.push('x_octail.features.broadcast_command must be a string');
  if (f.ready !== undefined && f.ready !== false) {
    const r = f.ready;
    if (!isObj(r)) p.push('x_octail.features.ready must be { port, proto, after_s }');
    else {
      if (r.port !== undefined && r.port !== 'primary' && !(ENV_NAME.test(str(r.port)) && hasVar(r.port)))
        p.push(`ready.port must be "primary" or a variable of the egg, not ${JSON.stringify(r.port)}`);
      if (r.proto !== undefined && !READY_PROTOS.includes(r.proto))
        p.push(`ready.proto must be one of ${READY_PROTOS.join(', ')}`);
      if (r.after_s !== undefined && (!Number.isInteger(r.after_s) || r.after_s < 0))
        p.push('ready.after_s must be a whole number ≥ 0');
    }
  }
  return p;
}

/** Problems with one parsed egg document. `path` is its repository path ("minecraft/paper.json"). */
export function eggProblems(egg, path, { forbidUpstreamImages = false } = {}) {
  if (!isObj(egg)) return ['the file is not a JSON object'];
  const p = [];
  if (!FORMATS.includes(egg.meta?.version)) p.push(`meta.version must be one of ${FORMATS.join(', ')}`);
  if (!str(egg.name).trim()) p.push('name is missing');
  if (!UUID.test(str(egg.uuid))) p.push('uuid is missing or not a uuid');
  if (!str(egg.author).trim()) p.push('author is missing');
  if (egg.description != null && typeof egg.description !== 'string') p.push('description must be a string');
  const url = egg.meta?.update_url;
  if (url != null) {
    if (typeof url !== 'string' || !url.startsWith('https://')) p.push('meta.update_url must be an https:// URL');
    else if (url.startsWith(RAW_BASE) && url !== RAW_BASE + path)
      p.push(`meta.update_url points at ${url.slice(RAW_BASE.length)}, not at this file`);
  }

  const images = egg.docker_images;
  if (!isObj(images) || Object.keys(images).length === 0) p.push('docker_images must be a non-empty object');
  else
    for (const [label, ref] of Object.entries(images))
      if (typeof ref !== 'string' || !ref.trim()) p.push(`docker_images["${label}"] has no image`);

  const startups = isObj(egg.startup_commands) ? Object.values(egg.startup_commands) : [egg.startup];
  if (!startups.some((s) => typeof s === 'string' && s.trim())) p.push('there is no startup command');
  if (!isObj(egg.config)) p.push('config is missing');
  else {
    for (const k of ['files', 'startup', 'logs'])
      if (typeof egg.config[k] === 'string' && egg.config[k].trim()) {
        try {
          JSON.parse(egg.config[k]);
        } catch {
          p.push(`config.${k} is not valid JSON`);
        }
      }
  }

  const inst = egg.scripts?.installation;
  if (!isObj(inst)) p.push('scripts.installation is missing');
  const script = str(inst?.script);
  if (inst && !script.trim()) p.push('the install script is empty');
  if (inst && !str(inst.container).trim()) p.push('the install script has no container image');
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
    for (const ref of [...Object.values(isObj(images) ? images : {}), str(inst?.container)])
      if (UPSTREAM_IMAGE.test(String(ref)))
        p.push(`uses the upstream image ${ref} (use ghcr.io/sneakywrld/octail-yolks)`);
  }

  const envNames = new Set();
  if (!Array.isArray(egg.variables)) p.push('variables must be a list');
  else
    for (const [i, v] of egg.variables.entries()) {
      const env = str(v?.env_variable);
      const label = `variable ${env || `#${i + 1}`}`;
      if (!ENV_NAME.test(env)) {
        p.push(`${label} has an invalid env name`);
        continue;
      }
      if (envNames.has(env)) p.push(`${label} is defined twice`);
      envNames.add(env);
      if (!str(v.name).trim()) p.push(`${label} has no name`);
      for (const k of ['user_viewable', 'user_editable'])
        if (v[k] !== undefined && ![true, false, 0, 1, '0', '1'].includes(v[k]))
          p.push(`${label}: ${k} must be true or false`);
      for (const r of ruleProblems(v.rules)) p.push(`${label}: ${r}`);
    }
  p.push(...xOctailProblems(egg.x_octail, envNames));
  return p;
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

/** Validates the repository at `root`. Returns { eggs: number, problems: [{ file, problem }] }. */
export function validateRepo(root, { forbidUpstreamImages = false } = {}) {
  const problems = [];
  const add = (file, problem) => problems.push({ file, problem });
  const uuids = new Map();
  let eggs = 0;
  for (const file of walk(root, root, [])) {
    if (/\.ya?ml$/i.test(file)) {
      add(file, 'eggs in this repository are JSON: convert YAML eggs');
      continue;
    }
    if (!file.endsWith('.json')) continue;
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
    for (const problem of eggProblems(egg, file, { forbidUpstreamImages })) add(file, problem);
    const uuid = str(egg?.uuid).toLowerCase();
    if (uuid) {
      if (uuids.has(uuid)) add(file, `uuid ${uuid} is also used by ${uuids.get(uuid)}`);
      else uuids.set(uuid, file);
    }
  }
  if (eggs === 0) add('.', 'no eggs found');
  return { eggs, problems };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const forbidUpstreamImages = args.includes('--forbid-upstream-images');
  const json = args.includes('--json');
  const dir = args.find((a) => !a.startsWith('--')) ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { eggs, problems } = validateRepo(resolve(dir), { forbidUpstreamImages });
  if (json) console.log(JSON.stringify({ eggs, problems }, null, 2));
  else {
    for (const { file, problem } of problems) console.log(`${file}: ${problem}`);
    console.log(problems.length ? `\n${problems.length} problem(s) in ${eggs} eggs.` : `${eggs} eggs, all valid.`);
  }
  process.exitCode = problems.length ? 1 : 0;
}
