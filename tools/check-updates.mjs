#!/usr/bin/env node
/**
 * Checks the versions our eggs pin (with a checksum next to them) against the upstream source each egg already
 * downloads from, and prints a table: egg, pin, pinned, latest, status. Standalone: plain Node (20+), no dependencies
 * and no API keys (a GITHUB_TOKEN in the environment is used for api.github.com when set, for its higher rate limit).
 * Network failures are reported as "unknown" for the pins they affect; they never stop the run.
 *
 *   node tools/check-updates.mjs [--json] [--markdown <file>] [--fail-on-outdated] [dir]
 *
 * `dir` defaults to the repository root; inside the Octail monorepo (where this file lives in
 * octail/scripts/eggs/repo-files/tools/) it falls back to octail/eggs/ (YAML eggs need the `yaml` package there).
 * With GITHUB_OUTPUT set (GitHub Actions) it also writes `outdated=<n>` and `unknown=<n>` there.
 *
 * What counts as a pin (each found in the install script, or in a variable's default the script reads):
 *   github      https://github.com/<owner>/<repo>/releases/download/<prefix>${VAR}<suffix>/… with VAR set to a literal
 *               (VAR=1.2.3, or VAR="${EGG_VARIABLE:-1.2.3}" with the variable's default): the newest release
 *               (prereleases only when the pinned release is one)
 *   jenkins     a Jenkins job URL (…/job/<Name>) with a <NAME>_BUILD variable holding a build number: the job's last
 *               successful build
 *   steamrt     repo.steampowered.com/steamrt-images-<branch>/snapshots/${VAR}: the snapshot the Steam client ships
 *   contentdb   <NAME>_URL=https://cdn.content.luanti.org/uploads/<file> # <Title> <version>: the package's newest
 *               release on ContentDB
 *   xonotic     dl.xonotic.org/xonotic-${VAR}: the newest xonotic-vX.Y.Z tag of the Xonotic GitLab project
 *   mojang      a MINECRAFT_VERSION/MC_VERSION default that is a release number, in an egg reading Mojang's version
 *               manifest: the latest release
 *   papermc     the same, in an egg reading the PaperMC API: the project's newest version
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'octail-eggs-check-updates (+https://github.com/sneakywrld/octail-eggs)';
const SKIP_DIRS = new Set(['.git', '.github', 'tools', 'node_modules']);
const TIMEOUT_MS = 20000;
const PRERELEASE = /[-_.]?(rc|alpha|beta|preview|pre|test)[-_.]?\d*\b/i;

/** ContentDB packages by the title the egg's comment gives them. */
export const CONTENTDB_PACKAGES = Object.freeze({
  'Minetest Game': 'Luanti/minetest_game',
  VoxeLibre: 'Wuzzy/mineclone2',
  MineClone2: 'Wuzzy/mineclone2',
});

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const concrete = (v) => typeof v === 'string' && v !== '' && !/^latest$/i.test(v) && !/[$`]/.test(v);
const norm = (s) =>
  str(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// --- reading the pins ------------------------------------------------------------------------------------------------

/** The egg's variables' defaults: Map(env → default). */
function defaults(egg) {
  return new Map(
    (Array.isArray(egg?.variables) ? egg.variables : [])
      .filter((v) => isObj(v) && v.env_variable)
      .map((v) => [String(v.env_variable), str(v.default_value)]),
  );
}

/**
 * What a shell variable holds in `script`: its literal assignment (`NAME=1.2.3`, `NAME="1.2.3"`), or for
 * `NAME="${VAR:-x}"` / `: ${VAR:=x}` the egg variable VAR's default (else x). null when it isn't a literal.
 */
export function shellValue(script, name, vars = new Map()) {
  const lines = str(script).split('\n');
  const assign = new RegExp(`^\\s*(?:export\\s+|readonly\\s+|local\\s+)?${name}=(.*)$`);
  for (const line of lines) {
    const m = assign.exec(line);
    if (!m) continue;
    let value = m[1].replace(/\s+#.*$/, '').trim();
    value = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    const ref = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-=](.*))?\}$/.exec(value);
    if (ref) {
      if (vars.has(ref[1])) return vars.get(ref[1]);
      return ref[2] ?? null;
    }
    if (!/[$`\s]/.test(value)) return value;
    return null;
  }
  if (vars.has(name)) return vars.get(name);
  const colon = new RegExp(`:\\s*"?\\$\\{${name}:?=['"]?([^'"}]*)['"]?\\}`).exec(str(script));
  return colon ? colon[1] : null;
}

/**
 * The pins one egg carries: [{ source, label, pinned, … }] (see the header). `egg` is the parsed document.
 */
export function findPins(egg) {
  const script = str(egg?.scripts?.installation?.script);
  const vars = defaults(egg);
  const pins = [];
  const seen = new Set();
  const push = (pin) => {
    const key = `${pin.source}:${pin.label}`;
    if (seen.has(key) || !concrete(pin.pinned)) return;
    seen.add(key);
    pins.push(pin);
  };

  // GitHub release downloads whose tag is built from a variable.
  for (const m of script.matchAll(
    /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/releases\/download\/([^/\s"'$]*)\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?([^/\s"'$]*)\//g,
  )) {
    const [, owner, repo, prefix, name, suffix] = m;
    const pinned = shellValue(script, name, vars);
    push({ source: 'github', label: `${owner}/${repo} release`, repo: `${owner}/${repo}`, prefix, suffix, pinned });
  }

  // A Jenkins job with a <NAME>_BUILD variable.
  for (const m of script.matchAll(/(https:\/\/[^\s"'$]+\/job\/([A-Za-z0-9_.-]+))/g)) {
    const [, job, jobName] = m;
    for (const [env, value] of vars)
      if (/_BUILD$/.test(env) && norm(env.replace(/_BUILD$/, '')) === norm(jobName) && /^\d+$/.test(value))
        push({ source: 'jenkins', label: `${jobName} build`, job, pinned: value });
  }

  // Steam Runtime snapshots.
  for (const m of script.matchAll(
    /repo\.steampowered\.com\/(steamrt-images-[a-z0-9]+)\/snapshots\/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,
  ))
    push({
      source: 'steamrt',
      label: `Steam Runtime (${m[1].replace('steamrt-images-', '')})`,
      branch: m[1],
      pinned: shellValue(script, m[2], vars),
    });

  // ContentDB uploads with "# <Title> <version>".
  for (const m of script.matchAll(
    /^\s*[A-Za-z_][A-Za-z0-9_]*=https:\/\/cdn\.content\.luanti\.org\/uploads\/([\w.-]+)\s*#\s*(.+?)\s+(\S+)\s*$/gm,
  )) {
    const [, file, title, version] = m;
    const pkg = CONTENTDB_PACKAGES[title];
    if (pkg) push({ source: 'contentdb', label: `${title} (ContentDB ${pkg})`, pkg, file, pinned: version });
  }

  // Xonotic releases.
  for (const m of script.matchAll(/dl\.xonotic\.org\/xonotic-\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g))
    push({ source: 'xonotic', label: 'Xonotic release', pinned: shellValue(script, m[1], vars) });

  // A pinned Minecraft version in an egg reading Mojang's manifest or the PaperMC API.
  for (const env of ['MINECRAFT_VERSION', 'MC_VERSION']) {
    const value = vars.get(env);
    if (!/^\d+\.\d+(\.\d+)?$/.test(str(value))) continue;
    if (/(piston-meta|launchermeta)\.mojang\.com/.test(script))
      push({ source: 'mojang', label: 'Minecraft release (Mojang)', pinned: value });
    if (/(fill|api)\.papermc\.io/.test(script)) {
      const project = /PROJECT:?=['"]?([a-z]+)/.exec(script)?.[1] ?? 'paper';
      push({ source: 'papermc', label: `Minecraft version (PaperMC ${project})`, project, pinned: value });
    }
  }
  return pins;
}

// --- the upstream side -----------------------------------------------------------------------------------------------

/** A small HTTP client over `fetch` (injectable for tests): getJson/getText with a timeout and a per-run cache. */
export function makeHttp(fetchImpl = globalThis.fetch, env = process.env) {
  const cache = new Map();
  const get = (url, kind) => {
    const key = `${kind} ${url}`;
    if (!cache.has(key)) {
      const headers = { 'User-Agent': USER_AGENT, Accept: kind === 'json' ? 'application/json' : '*/*' };
      if (env.GITHUB_TOKEN && new URL(url).hostname === 'api.github.com')
        headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
      const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
      cache.set(
        key,
        Promise.resolve()
          .then(() => fetchImpl(url, { headers, signal }))
          .then(async (res) => {
            if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
            return kind === 'json' ? res.json() : res.text();
          }),
      );
    }
    return cache.get(key);
  };
  return { getJson: (url) => get(url, 'json'), getText: (url) => get(url, 'text') };
}

/** Compares two version strings part by part (numbers numerically): <0, 0 or >0. */
export function compareVersions(a, b) {
  const pa = str(a)
    .split(/[^0-9A-Za-z]+/)
    .filter(Boolean);
  const pb = str(b)
    .split(/[^0-9A-Za-z]+/)
    .filter(Boolean);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    if (x === y) continue;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) - Number(y);
    if (x === '') return -1;
    if (y === '') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The newest upstream version for one pin: { latest, current? } (`current` overrides the version comparison). */
export async function latestFor(pin, http) {
  switch (pin.source) {
    case 'github': {
      const releases = await http.getJson(`https://api.github.com/repos/${pin.repo}/releases?per_page=30`);
      const tag = `${pin.prefix}${pin.pinned}${pin.suffix}`;
      // A release candidate or preview counts as a prerelease even when it isn't marked as one.
      const pre = (r) => r.prerelease === true || PRERELEASE.test(r.tag_name);
      const mine = releases.find((r) => r.tag_name === tag) ?? { tag_name: tag, prerelease: false };
      const pick = releases.filter((r) => !r.draft && (!pre(r) || pre(mine)));
      if (!pick.length) throw new Error(`${pin.repo} has no releases`);
      const latestTag = pick[0].tag_name;
      const latest =
        latestTag.startsWith(pin.prefix) && latestTag.endsWith(pin.suffix)
          ? latestTag.slice(pin.prefix.length, latestTag.length - pin.suffix.length || undefined)
          : latestTag;
      return { latest, current: latestTag === tag };
    }
    case 'jenkins': {
      const build = await http.getJson(`${pin.job}/lastSuccessfulBuild/api/json?tree=number`);
      return { latest: String(build.number) };
    }
    case 'steamrt': {
      const text = await http.getText(
        `https://repo.steampowered.com/${pin.branch}/snapshots/latest-steam-client-general-availability/VERSION.txt`,
      );
      return { latest: text.trim() };
    }
    case 'contentdb': {
      const releases = await http.getJson(`https://content.luanti.org/api/packages/${pin.pkg}/releases/`);
      if (!releases.length) throw new Error(`${pin.pkg} has no releases`);
      return { latest: str(releases[0].name || releases[0].title), current: str(releases[0].url).endsWith(pin.file) };
    }
    case 'xonotic': {
      const tags = await http.getJson(
        'https://gitlab.com/api/v4/projects/xonotic%2Fxonotic/repository/tags?per_page=100',
      );
      const versions = tags
        .map((t) => /^xonotic-v(\d+\.\d+\.\d+)$/.exec(t.name)?.[1])
        .filter(Boolean)
        .sort(compareVersions);
      if (!versions.length) throw new Error('no xonotic-vX.Y.Z tags');
      return { latest: versions.at(-1) };
    }
    case 'mojang': {
      const manifest = await http.getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      return { latest: str(manifest.latest?.release) };
    }
    case 'papermc': {
      const project = await http.getJson(`https://fill.papermc.io/v3/projects/${pin.project}`);
      const versions = Object.values(project.versions ?? {})
        .flat()
        .map(String);
      const stable = versions.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).sort(compareVersions);
      if (!stable.length) throw new Error(`PaperMC lists no versions for ${pin.project}`);
      return { latest: stable.at(-1) };
    }
    default:
      throw new Error(`unknown source ${pin.source}`);
  }
}

/** One row of the report: { egg, pin, source, pinned, latest, status: current|outdated|unknown, error? }. */
export async function checkPin(file, pin, http) {
  const row = { egg: file, pin: pin.label, source: pin.source, pinned: pin.pinned, latest: null, status: 'unknown' };
  try {
    const { latest, current } = await latestFor(pin, http);
    row.latest = latest || null;
    if (!latest) throw new Error('upstream gave no version');
    const same = current ?? compareVersions(latest, pin.pinned) <= 0;
    row.status = same ? 'current' : 'outdated';
  } catch (err) {
    row.error = String(err?.message ?? err);
  }
  return row;
}

// --- eggs on disk ----------------------------------------------------------------------------------------------------

function walk(dir, root, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, root, out);
    } else if (/\.(json|ya?ml)$/i.test(name)) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** Every egg document under `root`: [{ file, egg }] (files that aren't eggs are skipped). */
export async function readEggDocs(root) {
  const out = [];
  let yaml = null;
  for (const file of walk(root, root, [])) {
    const text = readFileSync(join(root, file), 'utf8').replace(/^\uFEFF/, '');
    let doc;
    try {
      if (/\.ya?ml$/i.test(file)) {
        yaml ??= await import('yaml').catch(() => false);
        if (!yaml) continue;
        doc = yaml.parse(text);
      } else doc = JSON.parse(text);
    } catch {
      continue;
    }
    if (isObj(doc) && isObj(doc.meta) && doc.scripts) out.push({ file, egg: doc });
  }
  return out;
}

/** Checks every pin of every egg under `root`. Returns the rows, sorted by egg. */
export async function checkUpdates(root, { http = makeHttp() } = {}) {
  const eggs = await readEggDocs(root);
  const jobs = eggs.flatMap(({ file, egg }) => findPins(egg).map((pin) => checkPin(file, pin, http)));
  const rows = await Promise.all(jobs);
  return rows.sort((a, b) => a.egg.localeCompare(b.egg) || a.pin.localeCompare(b.pin));
}

// --- output ----------------------------------------------------------------------------------------------------------

const STATUS = { current: 'up to date', outdated: 'OUTDATED', unknown: 'unknown' };

/** The rows as a plain-text table. */
export function textTable(rows) {
  const head = ['Egg', 'Pin', 'Pinned', 'Latest', 'Status'];
  const body = rows.map((r) => [
    r.egg,
    r.pin,
    r.pinned,
    r.latest ?? '?',
    r.error ? `${STATUS[r.status]} (${r.error})` : STATUS[r.status],
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => String(row[i]).length)));
  const line = (cells) =>
    cells
      .map((c, i) => String(c).padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

const md = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

/** The rows as the Markdown body of the "outdated eggs" issue. */
export function markdownReport(rows, { runUrl = null } = {}) {
  const outdated = rows.filter((r) => r.status === 'outdated');
  const unknown = rows.filter((r) => r.status === 'unknown');
  const out = [
    '<!-- octail-eggs: check-updates -->',
    `The weekly check of the versions our eggs pin found ${outdated.length} outdated pin(s) out of ${rows.length}` +
      (unknown.length ? ` (${unknown.length} couldn't be checked).` : '.'),
    '',
    'Eggs are changed in the Octail monorepo (`octail/eggs/`) and come back here with the next publish: bump the',
    'version together with its checksum, test the install on a node, then publish.',
    '',
    '| Egg | Pin | Pinned | Latest | Status |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| \`${md(r.egg)}\` | ${md(r.pin)} | ${md(r.pinned)} | ${md(r.latest ?? '?')} | ${
          r.status === 'outdated' ? '**outdated**' : r.status === 'current' ? 'up to date' : `unknown: ${md(r.error)}`
        } |`,
    ),
    '',
    'Made by `node tools/check-updates.mjs`' + (runUrl ? ` ([this run](${runUrl})).` : '.'),
    '',
  ];
  return out.join('\n');
}

/** Where to look by default: this repository's root, or octail/eggs/ when running inside the Octail monorepo. */
export function defaultRoot(here = HERE) {
  // In the monorepo this file is octail/scripts/eggs/repo-files/tools/, next to scripts/eggs/build-repo.mjs.
  const monorepo = existsSync(resolve(here, '../../build-repo.mjs')) && resolve(here, '../../../../eggs');
  return monorepo && existsSync(monorepo) ? monorepo : resolve(here, '..');
}

function parseArgs(argv) {
  const args = { json: false, markdown: null, failOnOutdated: false, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--fail-on-outdated') args.failOnOutdated = true;
    else if (a === '--markdown') args.markdown = argv[++i];
    else if (a.startsWith('--markdown=')) args.markdown = a.slice('--markdown='.length);
    else if (a.startsWith('--')) throw new Error(`unknown argument ${a}`);
    else args.dir = a;
  }
  return args;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const root = args.dir ? resolve(args.dir) : defaultRoot();
    const rows = await checkUpdates(root);
    const outdated = rows.filter((r) => r.status === 'outdated').length;
    const unknown = rows.filter((r) => r.status === 'unknown').length;
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else {
      console.log(textTable(rows));
      console.log(`\n${rows.length} pin(s): ${outdated} outdated, ${unknown} unknown.`);
    }
    if (args.markdown) {
      const runUrl = process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null;
      writeFileSync(args.markdown, markdownReport(rows, { runUrl }));
    }
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `outdated=${outdated}\nunknown=${unknown}\n`);
    process.exitCode = args.failOnOutdated && outdated ? 1 : 0;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
