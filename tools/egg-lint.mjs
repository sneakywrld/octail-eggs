/**
 * Lint rules for eggs: mistakes the egg format allows but that make a server misbehave (a variable the startup line
 * names but nothing defines, a default its own rules refuse, an image that isn't ours, …). Standalone like
 * validate.mjs, which runs it: plain Node, no dependencies beyond tools/egg-format.mjs.
 *
 * Each finding is { rule, level, message }; `level` is "error" (the egg is broken or breaks this repository's policy:
 * validate.mjs fails) or "warning" (probably a mistake, but there are legitimate reasons: reported, doesn't fail
 * unless --strict). The rules, with their level:
 *
 *   image-not-yolks              error    an image or the install container isn't ghcr.io/sneakywrld/octail-yolks:<tag>
 *   image-unknown-tag            error    an octail-yolks tag that isn't in the image list (tools/yolks-tags.txt)
 *   stop-missing                 error    no stop command (config.stop): the panel can only kill the server
 *   done-missing                 warning  no ready text (config.startup.done) and no port readiness (features.ready)
 *   startup-undefined-variable   error    the startup line uses {{NAME}} but no variable NAME exists
 *   variable-unused              warning  a variable nothing reads (startup, install script, config files, features)
 *   default-breaks-rules         error    a variable's default value fails its own rules (in:, regex:, integer, max:, …)
 *   required-without-default     warning  a required variable with an empty default: every new server needs a value
 *   port-not-in-startup          warning  a port variable (port_vars) that neither the startup line nor a config
 *                                         file passes to the game
 *   insecure-download            error    curl -k / --insecure, wget --no-check-certificate in the install script
 *   download-without-checksum    warning  the install script downloads from a source that publishes checksums
 *                                         (GitHub release digests, Mojang, PaperMC, Adoptium, Modrinth) and checks none
 *
 * (Downloads over http:// are refused by validate.mjs itself.)
 */
import {
  eggFeatures,
  eggImages,
  eggStartupCommands,
  generatedSecretVariables,
  phpRegex,
  RESERVED_ENV,
  rconVariables,
  splitRules,
} from './egg-format.mjs';

export const YOLKS_REGISTRY = 'ghcr.io/sneakywrld/octail-yolks';
const YOLKS_REF = /^ghcr\.io\/sneakywrld\/octail-yolks:([a-z0-9_.-]+)$/;

/** Every rule this file has, with its level. */
export const LINT_RULES = Object.freeze({
  'image-not-yolks': 'error',
  'image-unknown-tag': 'error',
  'stop-missing': 'error',
  'done-missing': 'warning',
  'startup-undefined-variable': 'error',
  'variable-unused': 'warning',
  'default-breaks-rules': 'error',
  'required-without-default': 'warning',
  'port-not-in-startup': 'warning',
  'insecure-download': 'error',
  'download-without-checksum': 'warning',
});

/**
 * Env vars our runtime images (octail-yolks entrypoint and hooks) or Tentacle read themselves, so an egg variable
 * with one of these names is used even when no script names it.
 */
export const IMAGE_ENV = Object.freeze([
  'AUTO_UPDATE',
  'DISPLAY_DEPTH',
  'DISPLAY_HEIGHT',
  'DISPLAY_WIDTH',
  'FRAMEWORK',
  'GE_PROTON_VERSION',
  'HLDS_GAME',
  'INSTALL_FLAGS',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'PROTON_LOG',
  'SRCDS_APPID',
  'SRCDS_BETAID',
  'SRCDS_BETAPASS',
  'STEAM_AUTH',
  'STEAM_COMPAT_DATA_PATH',
  'STEAM_PASS',
  'STEAM_SDK',
  'STEAM_USER',
  'VALIDATE',
  'WINDOWS_INSTALL',
  'WINE_BRANCH',
  'WINEARCH',
  'WINEDEBUG',
  'WINEDLLOVERRIDES',
  'WINEPATH',
  'WINEPREFIX',
  'WINETRICKS_RUN',
  'XVFB',
]);

/** Env vars well-known runtimes read themselves (Wine, SQLite, .NET, the JVM, glibc, locales). */
const RUNTIME_ENV =
  /^(WINE[A-Z_]*|SQLITE_TMPDIR|DOTNET_[A-Z0-9_]+|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|MALLOC_[A-Z_]+|LANG|LC_[A-Z]+)$/;

/** Names the startup line may use without a variable: what Octail/Tentacle set for every server. */
const BUILTIN = new Set([...RESERVED_ENV, 'SERVER_MEMORY', 'SERVER_IP', 'SERVER_PORT']);

/** Download sources that publish a checksum next to the file, and how the rule names them. */
export const CHECKSUM_SOURCES = Object.freeze([
  { pattern: /api\.github\.com\/repos\/[^\s"']+\/releases/, name: 'GitHub releases (each asset has a sha256 digest)' },
  { pattern: /(piston-meta|launchermeta)\.mojang\.com/, name: "Mojang's version manifest (sha1)" },
  { pattern: /(fill|api)\.papermc\.io/, name: 'the PaperMC API (sha256)' },
  { pattern: /api\.adoptium\.net/, name: 'the Adoptium API (sha256)' },
  { pattern: /api\.modrinth\.com/, name: 'the Modrinth API (sha512)' },
]);
const CHECKSUM_USE =
  /\b(sha(1|224|256|384|512)sum|shasum|md5sum|b2sum|openssl\s+dgst)\b|\.digest\b|"digest"|\bdigest\b/;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** `{{NAME}}` / `{{env.NAME}}` / `{{server.build.env.NAME}}` names in a text. */
function templateNames(text) {
  const out = new Set();
  for (const m of str(text).matchAll(
    /\{\{\s*(?:server\.build\.env\.|server\.environment\.|env\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
  ))
    out.add(m[1]);
  return out;
}
/** `$NAME` / `${NAME…}` names in a shell text. */
function shellNames(text) {
  const out = new Set();
  for (const m of str(text).matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) out.add(m[1]);
  return out;
}

/** Variable names an egg's features point at (ports, RCON, players, EULA switch, secrets, readiness, …). */
function featureNames(features) {
  const out = new Set();
  const add = (v) => typeof v === 'string' && v && out.add(v);
  if (isObj(features.port_vars)) Object.keys(features.port_vars).forEach(add);
  for (const k of ['rcon', 'player_query', 'players', 'steam_login', 'steam_workshop', 'sleep', 'thunderstore'])
    if (isObj(features[k])) for (const [key, v] of Object.entries(features[k])) if (/_var$|^env$/.test(key)) add(v);
  if (isObj(features.eula_variable)) add(features.eula_variable.env);
  if (isObj(features.ready)) add(features.ready.port);
  if (Array.isArray(features.generated_secrets)) features.generated_secrets.forEach(add);
  // Anything else under x_octail.features that is a string naming an env var in an `*_var`/`*_env` key.
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (isObj(o))
      for (const [k, v] of Object.entries(o)) {
        if (/_(var|env)$/.test(k)) add(v);
        else walk(v);
      }
  };
  walk(features);
  return out;
}

/** The text of every config file's `find` values (where `{{server.build.env.X}}` / `{{env.X}}` go). */
function configText(egg) {
  let files = egg.config?.files;
  if (typeof files === 'string') {
    try {
      files = JSON.parse(files);
    } catch {
      files = null;
    }
  }
  return isObj(files) ? JSON.stringify(files) : '';
}

function configPart(egg, key) {
  let v = egg.config?.[key];
  if (typeof v === 'string' && key !== 'stop') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  return v;
}

// --- variable defaults against their rules ---------------------------------------------------------------------------

const isInteger = (s) => /^[+-]?\d+$/.test(s);
const isNumeric = (s) => s.trim() !== '' && Number.isFinite(Number(s));

/**
 * Why `value` (a default) fails `rules`, as messages; [] when it passes. Covers the rules eggs use, read the way
 * Laravel (and Octail's own checker) reads them; an empty value is only checked by `required`.
 */
export function defaultRuleProblems(value, rules) {
  const list = splitRules(rules);
  const names = list.map((r) => r.split(':')[0]);
  const v = str(value);
  if (v === '') return [];
  const numeric = names.includes('integer') || names.includes('numeric');
  const size = numeric && isNumeric(v) ? Number(v) : [...v].length;
  const p = [];
  for (const rule of list) {
    const i = rule.indexOf(':');
    const name = i === -1 ? rule : rule.slice(0, i);
    const arg = i === -1 ? '' : rule.slice(i + 1);
    const n = Number(arg);
    switch (name) {
      case 'integer':
        if (!isInteger(v)) p.push('is not a whole number (integer)');
        break;
      case 'numeric':
        if (!isNumeric(v)) p.push('is not a number (numeric)');
        break;
      case 'boolean':
        if (!['0', '1', 'true', 'false'].includes(v)) p.push('is not 0, 1, true or false (boolean)');
        break;
      case 'alpha':
        if (!/^[\p{L}\p{M}]+$/u.test(v)) p.push('has characters other than letters (alpha)');
        break;
      case 'alpha_num':
        if (!/^[\p{L}\p{M}\p{N}]+$/u.test(v)) p.push('has characters other than letters and digits (alpha_num)');
        break;
      case 'alpha_dash':
        if (!/^[\p{L}\p{M}\p{N}_-]+$/u.test(v))
          p.push('has characters other than letters, digits, - and _ (alpha_dash)');
        break;
      case 'in':
        if (!arg.split(',').includes(v)) p.push(`is not one of ${arg} (in)`);
        break;
      case 'not_in':
        if (arg.split(',').includes(v)) p.push(`is one of ${arg} (not_in)`);
        break;
      case 'regex': {
        const re = phpRegex(arg);
        if (re && !re.test(v)) p.push(`doesn't match ${arg} (regex)`);
        break;
      }
      case 'not_regex': {
        const re = phpRegex(arg);
        if (re && re.test(v)) p.push(`matches ${arg} (not_regex)`);
        break;
      }
      case 'max':
        if (Number.isFinite(n) && size > n) p.push(numeric ? `is above ${arg} (max)` : `is longer than ${arg} (max)`);
        break;
      case 'min':
        if (Number.isFinite(n) && size < n) p.push(numeric ? `is below ${arg} (min)` : `is shorter than ${arg} (min)`);
        break;
      case 'size':
        if (Number.isFinite(n) && size !== n) p.push(`is not of size ${arg} (size)`);
        break;
      case 'between': {
        const [lo, hi] = arg.split(',').map(Number);
        if (Number.isFinite(lo) && Number.isFinite(hi) && (size < lo || size > hi))
          p.push(`is not between ${lo} and ${hi} (between)`);
        break;
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if (!Number.isFinite(n) || !isNumeric(v)) break;
        const x = Number(v);
        const ok = { gt: x > n, gte: x >= n, lt: x < n, lte: x <= n }[name];
        if (!ok) p.push(`fails ${rule}`);
        break;
      }
      case 'digits':
        if (!/^\d+$/.test(v) || v.length !== n) p.push(`is not ${arg} digits (digits)`);
        break;
      case 'digits_between': {
        const [lo, hi] = arg.split(',').map(Number);
        if (!/^\d+$/.test(v) || v.length < lo || v.length > hi) p.push(`is not ${lo} to ${hi} digits (digits_between)`);
        break;
      }
      case 'url':
        if (!/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(v)) p.push('is not a URL (url)');
        break;
      default:
        break;
    }
  }
  return p;
}

// --- the lint --------------------------------------------------------------------------------------------------------

/**
 * Lints one parsed egg. `yolksTags` (a Set of octail-yolks tags, or null when the list isn't available) turns on
 * image-unknown-tag. Returns [{ rule, level, message }].
 */
export function eggLint(egg, { yolksTags = null } = {}) {
  if (!isObj(egg)) return [];
  const out = [];
  const add = (rule, message) => out.push({ rule, level: LINT_RULES[rule], message });

  // Images: ours only, and tags that exist.
  const inst = isObj(egg.scripts?.installation) ? egg.scripts.installation : {};
  const refs = [
    ...Object.entries(eggImages(egg)).map(([label, ref]) => [`docker_images["${label}"]`, str(ref).trim()]),
    ...(str(inst.container).trim() ? [['the install container', str(inst.container).trim()]] : []),
  ];
  for (const [where, ref] of refs) {
    if (!ref) continue;
    const m = YOLKS_REF.exec(ref);
    if (!m) add('image-not-yolks', `${where} is ${ref}, not a ${YOLKS_REGISTRY}:<tag> image`);
    else if (yolksTags && !yolksTags.has(m[1]) && !yolksTags.has(m[1].replace(/-\d{8}$/, '')))
      add('image-unknown-tag', `${where} uses the tag ${m[1]}, which octail-yolks doesn't build`);
  }

  // Stopping and start detection.
  const features = eggFeatures(egg);
  if (!str(egg.config?.stop).trim())
    add('stop-missing', 'config.stop is empty: the panel can only kill the server (use "^C" for SIGINT)');
  const startupCfg = configPart(egg, 'startup');
  const done = isObj(startupCfg) ? startupCfg.done : null;
  const hasDone = Array.isArray(done) ? done.some((d) => str(d).trim()) : str(done).trim() !== '';
  if (!hasDone && !isObj(features.ready))
    add(
      'done-missing',
      'config.startup.done is empty and there is no port readiness (features.ready): the server never shows as started',
    );

  // Variables.
  const variables = (Array.isArray(egg.variables) ? egg.variables : []).filter((v) => isObj(v));
  const defined = new Set(variables.map((v) => str(v.env_variable).trim()).filter(Boolean));
  const startups = Object.values(eggStartupCommands(egg)).map(str);
  const startupText = startups.join('\n');
  for (const name of [...new Set(startups.flatMap((s) => [...templateNames(s)]))])
    if (!defined.has(name) && !BUILTIN.has(name) && !/^P_SERVER_/.test(name))
      add('startup-undefined-variable', `the startup line uses {{${name}}}, but the egg has no variable ${name}`);

  const script = str(inst.script);
  const config = configText(egg);
  const fromFeatures = featureNames(features);
  // Filled by the panel when a server is created: assigned ports, the RCON password, generated secrets.
  const panelFilled = new Set([
    ...(isObj(features.port_vars) ? Object.keys(features.port_vars) : []),
    ...generatedSecretVariables(features),
    rconVariables(features).port,
  ]);
  const used = new Set([
    ...templateNames(startupText),
    ...shellNames(startupText),
    ...templateNames(script),
    ...shellNames(script),
    ...templateNames(config),
    ...templateNames(JSON.stringify(startupCfg ?? '')),
    ...fromFeatures,
  ]);
  for (const v of variables) {
    const env = str(v.env_variable).trim();
    if (!env) continue;
    if (
      !used.has(env) &&
      !IMAGE_ENV.includes(env) &&
      !RUNTIME_ENV.test(env) &&
      !script.includes(env) &&
      !startupText.includes(env)
    )
      add(
        'variable-unused',
        `variable ${env} isn't read by the startup line, the install script, a config file or a feature (fine if the game reads it from its environment)`,
      );
    const rules = splitRules(v.rules);
    const names = rules.map((r) => r.split(':')[0]);
    const value = v.default_value;
    if (str(value) === '' && names.includes('required') && !panelFilled.has(env))
      add('required-without-default', `variable ${env} is required but has no default: every new server needs a value`);
    for (const problem of defaultRuleProblems(value, rules))
      add('default-breaks-rules', `variable ${env}: the default ${JSON.stringify(str(value))} ${problem}`);
  }

  // Ports the panel assigns that never reach the game.
  if (isObj(features.port_vars)) {
    const passed = new Set([...templateNames(startupText), ...shellNames(startupText), ...templateNames(config)]);
    for (const name of Object.keys(features.port_vars))
      if (!passed.has(name) && !startupText.includes(name))
        add(
          'port-not-in-startup',
          `port variable ${name} (port_vars) isn't passed to the game by the startup line or a config file`,
        );
  }

  // Downloads.
  const lines = script.split('\n').filter((l) => !/^\s*#/.test(l));
  const code = lines.join('\n');
  if (/\bcurl\b[^\n]*\s(-k|--insecure)\b|\bwget\b[^\n]*--no-check-certificate/.test(code))
    add(
      'insecure-download',
      'the install script turns TLS certificate checks off (curl -k, wget --no-check-certificate)',
    );
  if (!CHECKSUM_USE.test(code)) {
    const sources = CHECKSUM_SOURCES.filter((s) => s.pattern.test(code)).map((s) => s.name);
    if (sources.length)
      add(
        'download-without-checksum',
        `the install script downloads from ${sources.join(' and ')} but checks no checksum`,
      );
  }
  return out;
}
