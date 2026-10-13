/**
 * The egg format's rules, in one place (docs/dev/eggs.md describes every field). Read by:
 *   - the panel's importer (panel/src/services/eggs/normalize.js): `errors` stop an import, `warnings` are shown with it;
 *   - the standalone validator of github.com/sneakywrld/octail-eggs (scripts/eggs/repo-files/tools/validate.mjs), which
 *     reports both as problems and adds the repository's own policy (uuid, author, layout, SteamCMD retries, …);
 *   - the panel and the web app for the feature parsers below (port specs, port readiness, Workshop, install sandbox).
 *
 * Plain JavaScript with no imports at all and nothing newer than Node 20: build-repo.mjs publishes this very file as
 * the repository's `tools/egg-format.mjs`, next to `tools/validate.mjs`. A copy lives at
 * scripts/eggs/repo-files/tools/egg-format.mjs so the validator runs from the monorepo too; panel/test/egg-format.test.js
 * checks it is the same file (`cp shared/src/egg-format.js scripts/eggs/repo-files/tools/egg-format.mjs` after a change).
 *
 * Tentacle reads a few features itself (rcon, player_query, players, tty_size); their constants are repeated here and
 * the same test compares them with Tentacle's source. A value the rules accept is one the panel and Tentacle use as
 * written; a value they warn about is off (or falls back to its default), never guessed at: the feature readers below
 * (rconFeature, sleepSetting, steamLogin, eulaVariable, …) are what the panel uses, and the test holds Tentacle to them.
 */

/** The `meta.version` values Octail reads. */
export const EGG_FORMATS = Object.freeze(['PTDL_v1', 'PTDL_v2', 'PLCN_v1', 'PLCN_v2', 'PLCN_v3']);

/** Env vars Octail/Tentacle set for every server (plan §6.2); an egg variable with one of these names is renamed. */
export const RESERVED_ENV = Object.freeze([
  'STARTUP',
  'SERVER_MEMORY',
  'SERVER_IP',
  'SERVER_PORT',
  'P_SERVER_UUID',
  'P_SERVER_ALLOCATION_LIMIT',
  'P_SERVER_LOCATION',
  'TZ',
  'HOME',
  'USER',
  'PATH',
]);
/** Built-ins an egg feature may name as a port or variable without defining it. */
const BUILTIN_VARS = new Set(['SERVER_PORT', 'SERVER_IP']);

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
/** A flag the importer reads as on (`true`, 1, "yes", "on", …). */
const isOn = (v) => v === true || ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
// What the importer reads as a flag (anything else counts as false).
const isBoolish = (v) =>
  typeof v === 'boolean' ||
  v === 0 ||
  v === 1 ||
  (typeof v === 'string' && ['', '0', '1', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(v.toLowerCase()));

// --- variable rules ------------------------------------------------------------------------------------------------

/** Laravel rules Octail checks values against (shared/src/egg-rules.js); anything else is ignored there. */
export const RULES_PLAIN = Object.freeze([
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
export const RULES_NUMBER = Object.freeze(['min', 'max', 'size', 'digits', 'gt', 'gte', 'lt', 'lte']);
export const RULES_TWO_NUMBERS = Object.freeze(['between', 'digits_between']);
export const RULES_LIST = Object.freeze(['in', 'not_in']);
export const RULES_REGEX = Object.freeze(['regex', 'not_regex']);

/**
 * Laravel rules as an array. Splits "required|string|max:20" on "|" but keeps a regex rule whole even when the
 * pattern itself contains "|", e.g. "nullable|regex:/^(a|b)$/". PHP's empty array exported as `{}` is no rules.
 */
export function splitRules(rules) {
  if (Array.isArray(rules)) return rules.map(String).filter(Boolean);
  if (rules == null || rules === '') return [];
  if (isObj(rules) && Object.keys(rules).length === 0) return [];
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
  const d = String(pattern ?? '')[0];
  const end = String(pattern).lastIndexOf(d);
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

/** Problems with one variable's `rules` (a string or a list), as messages. */
export function ruleProblems(rules) {
  if (rules != null && typeof rules !== 'string' && !Array.isArray(rules)) {
    if (!isObj(rules) || Object.keys(rules).length > 0) return ['rules must be a string or a list'];
  }
  const problems = [];
  const isNum = (s) => s.trim() !== '' && Number.isFinite(Number(s));
  for (const rule of splitRules(rules)) {
    const i = rule.indexOf(':');
    const name = i === -1 ? rule : rule.slice(0, i);
    const arg = i === -1 ? '' : rule.slice(i + 1);
    if (RULES_PLAIN.includes(name)) continue;
    if (RULES_NUMBER.includes(name)) {
      if (!isNum(arg)) problems.push(`rule "${rule}" needs a number`);
    } else if (RULES_TWO_NUMBERS.includes(name)) {
      const parts = arg.split(',');
      if (parts.length !== 2 || !parts.every(isNum)) problems.push(`rule "${rule}" needs two numbers`);
      else if (Number(parts[0]) > Number(parts[1])) problems.push(`rule "${rule}" has its bounds the wrong way round`);
    } else if (RULES_LIST.includes(name)) {
      if (arg === '') problems.push(`rule "${rule}" needs a list of values`);
    } else if (RULES_REGEX.includes(name)) {
      if (!phpRegex(arg)) problems.push(`rule "${rule}" has a pattern that doesn't compile`);
    } else problems.push(`unknown rule "${rule}"`);
  }
  return problems;
}

// --- the document's parts as the importer reads them ---------------------------------------------------------------

/**
 * The egg's images as `{ label: ref }`, as written (the importer qualifies short names afterwards). `docker_images`
 * (a map, or a list of refs), else PTDL_v1's `images` list or single `image` string (not a `data:` icon).
 */
export function eggImages(raw) {
  let images = raw?.docker_images;
  const legacy = raw?.images ?? (typeof raw?.image === 'string' && !raw.image.startsWith('data:') ? [raw.image] : null);
  if (raw?.meta?.version === 'PTDL_v1' || (!images && legacy)) images = Array.isArray(legacy) ? legacy : [];
  if (Array.isArray(images)) images = Object.fromEntries(images.map((i) => [i, i]));
  return isObj(images) ? images : {};
}

/** The egg's startup commands as `{ name: command }` (PTDL/PLCN_v1–2's single `startup` becomes "Default"). */
export function eggStartupCommands(raw) {
  if (raw?.meta?.version === 'PLCN_v3' && isObj(raw.startup_commands))
    return Object.fromEntries(Object.entries(raw.startup_commands).map(([k, v]) => [String(k), String(v)]));
  if (typeof raw?.startup === 'string' && raw.startup.trim()) return { Default: raw.startup };
  if (isObj(raw?.startup_commands)) return { ...raw.startup_commands };
  return {};
}

/**
 * The egg's features: Pelican's `features` (a list of flags, each `true`, or an object) with `x_octail.features`
 * (Octail's options, which other panels ignore) on top.
 */
export function eggFeatures(raw) {
  const features = {};
  if (Array.isArray(raw?.features)) for (const f of raw.features) features[String(f)] = true;
  else if (isObj(raw?.features)) Object.assign(features, raw.features);
  if (isObj(raw?.x_octail?.features)) Object.assign(features, raw.x_octail.features);
  return features;
}

/** The env name a variable gets on import: its own, or `SERVER_<name>` for a reserved one. */
export const importedEnvName = (env) => (RESERVED_ENV.includes(env) ? `SERVER_${env}` : env);

// --- ports: port_vars, fixed_ports, ready --------------------------------------------------------------------------

/** "primary+1" → 1, "primary-2" → -2, anything else → null. */
export function parsePortSpec(spec) {
  const m = /^primary\s*([+-])\s*(\d{1,5})$/.exec(String(spec ?? '').trim());
  if (!m) return null;
  return (m[1] === '+' ? 1 : -1) * Number(m[2]);
}

/**
 * The egg's fixed ports, `[{ label, offset, optional }]`, smallest offset first. `fixed_ports` maps a label to
 * "primary+N" or to `{ port: "primary+N", optional: true }`. Entries that don't parse (or would be the main port
 * itself) come back in `invalid` as messages.
 */
export function fixedPortSpecs(features) {
  const ports = [];
  const invalid = [];
  if (!isObj(features?.fixed_ports)) return { ports, invalid };
  for (const [label, raw] of Object.entries(features.fixed_ports)) {
    const spec = isObj(raw) ? raw.port : raw;
    const offset = parsePortSpec(spec);
    if (offset == null || offset === 0) {
      invalid.push(`fixed_ports: "${label}" needs a port like "primary+400", not ${JSON.stringify(spec ?? null)}`);
      continue;
    }
    if (isObj(raw) && raw.optional !== undefined && typeof raw.optional !== 'boolean')
      invalid.push(`fixed_ports: "${label}".optional must be true or false`);
    ports.push({ label: String(label), offset, optional: isObj(raw) && raw.optional === true });
  }
  ports.sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label));
  return { ports, invalid };
}

/** Protocols an egg's port readiness can wait for. */
export const READY_PROTOS = Object.freeze(['udp', 'tcp', 'any']);

/**
 * The egg's port readiness (`ready` feature): `{ port: "primary" | "<VARIABLE>", proto, after_s }`. Returns
 * `{ ready, invalid }`: the spec with its defaults filled in (null when the egg doesn't use it or it can't be used)
 * and the problems as messages. `envNames` (a Set of the egg's variables), when given, checks a variable port exists.
 */
export function readyPortSpec(features, envNames = null) {
  const raw = features?.ready;
  if (raw === undefined || raw === null || raw === false) return { ready: null, invalid: [] };
  if (!isObj(raw))
    return { ready: null, invalid: ['features.ready must be { port, proto, after_s } (port readiness)'] };
  const invalid = [];
  const port = String(raw.port ?? 'primary').trim();
  if (port !== 'primary') {
    if (!ENV_NAME.test(port))
      invalid.push(`ready.port must be "primary" or a variable name, not ${JSON.stringify(raw.port)}`);
    else if (envNames && !envNames.has(port) && port !== 'SERVER_PORT')
      invalid.push(`ready.port: ${port} is not a variable of the egg`);
  }
  const proto = raw.proto ?? 'any';
  if (!READY_PROTOS.includes(proto)) invalid.push(`ready.proto must be one of ${READY_PROTOS.join(', ')}`);
  const afterS = raw.after_s ?? 0;
  if (!Number.isInteger(afterS) || afterS < 0) invalid.push('ready.after_s must be a whole number of seconds ≥ 0');
  if (invalid.length) return { ready: null, invalid };
  return { ready: { port, proto, after_s: afterS }, invalid };
}

// --- install sandbox -----------------------------------------------------------------------------------------------

/** Capabilities an egg may add on top of the installer's own five: Docker's default set only. */
export const INSTALL_EXTRA_CAPS = Object.freeze([
  'FSETID',
  'KILL',
  'SETFCAP',
  'SETPCAP',
  'MKNOD',
  'NET_BIND_SERVICE',
  'SYS_CHROOT',
  'AUDIT_WRITE',
]);
/** The `install_sandbox` keys and their limits (shared/src/install-sandbox.js builds its schema from these). */
export const INSTALL_SANDBOX_NETWORKS = Object.freeze(['internet', 'none']);
export const INSTALL_SANDBOX_MAX = Object.freeze({ timeout_s: 604800, memory_mb: 65536 });

/** Problems with `install_sandbox`: one problem means the whole override is ignored (the node's defaults apply). */
export function installSandboxProblems(s) {
  if (s == null) return [];
  if (!isObj(s)) return ['features.install_sandbox must be an object'];
  const p = [];
  for (const k of Object.keys(s))
    if (!['network', 'timeout_s', 'memory_mb', 'cap_add'].includes(k))
      p.push(`install_sandbox has an unknown key "${k}"`);
  if (s.network !== undefined && !INSTALL_SANDBOX_NETWORKS.includes(s.network))
    p.push(`install_sandbox.network must be one of ${INSTALL_SANDBOX_NETWORKS.join(', ')}`);
  for (const [k, max] of Object.entries(INSTALL_SANDBOX_MAX))
    if (s[k] !== undefined && s[k] !== null && !isInt(s[k], 0, max))
      p.push(`install_sandbox.${k} must be a whole number from 0 to ${max} (or null)`);
  if (
    s.cap_add !== undefined &&
    (!Array.isArray(s.cap_add) ||
      s.cap_add.length > INSTALL_EXTRA_CAPS.length ||
      !s.cap_add.every((c) => INSTALL_EXTRA_CAPS.includes(c)))
  )
    p.push(`install_sandbox.cap_add must be a list of ${INSTALL_EXTRA_CAPS.join(', ')}`);
  return p;
}

// --- Steam Workshop ------------------------------------------------------------------------------------------------

/** Built-in Workshop games. `app_id` is the Workshop's app (the game, not its dedicated server). */
export const WORKSHOP_GAMES = Object.freeze({
  garrysmod: Object.freeze({
    label: "Garry's Mod",
    app_id: 4000,
    method: 'gmod',
    collection_variable: 'WORKSHOP_ID',
    lua_file: 'garrysmod/lua/autorun/server/workshop.lua',
    max_collections: 1,
  }),
  ark: Object.freeze({
    label: 'ARK: Survival Evolved',
    app_id: 346110,
    method: 'steamcmd',
    mods_dir: 'ShooterGame/Content/Mods',
    unpack: 'ark',
    branch: 'Windows',
  }),
  arma3: Object.freeze({
    label: 'Arma 3',
    app_id: 107410,
    method: 'steamcmd',
    mods_dir: 'workshop',
  }),
});
export const WORKSHOP_METHODS = Object.freeze(['gmod', 'steamcmd']);
/** What Tentacle can do with SteamCMD downloads after the install step (`unpack`). */
export const WORKSHOP_UNPACK = Object.freeze(['ark']);
/** ARK's mod content folders: `<branch>NoEditor`. */
export const WORKSHOP_BRANCHES = Object.freeze(['Windows', 'Linux']);
const WORKSHOP_VARIABLE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** A relative path inside the server folder: no `..`, no leading slash, plain characters. */
export function isSafeRelativePath(p) {
  if (typeof p !== 'string' || !p || p.length > 200 || p.startsWith('/')) return false;
  if (!/^[A-Za-z0-9._/ -]+$/.test(p)) return false;
  return p.split('/').every((part) => part && part !== '.' && part !== '..');
}

/**
 * The Workshop settings of an egg (`features.steam_workshop`), or null when the egg doesn't use the Workshop (or
 * describes it in a way Octail can't use). Answers `{ game, label, app_id, method, ... }`.
 */
export function workshopGame(egg) {
  let raw = egg?.features?.steam_workshop;
  if (!raw) return null;
  if (typeof raw === 'string') raw = { game: raw };
  if (raw === true || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const base = raw.game ? WORKSHOP_GAMES[raw.game] : null;
  if (raw.game && !base) return null;
  const out = { game: raw.game ?? 'custom', label: 'Steam Workshop', ...(base ?? {}) };
  for (const key of [
    'label',
    'app_id',
    'method',
    'mods_dir',
    'ids_variable',
    'collection_variable',
    'lua_file',
    'unpack',
    'branch',
  ]) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  if (raw.max_collections !== undefined) out.max_collections = raw.max_collections;
  out.app_id = Number(out.app_id);
  if (!Number.isSafeInteger(out.app_id) || out.app_id <= 0) return null;
  if (!WORKSHOP_METHODS.includes(out.method)) return null;
  if (out.method === 'steamcmd' && !isSafeRelativePath(out.mods_dir)) return null;
  if (out.method === 'gmod' && !isSafeRelativePath(out.lua_file)) return null;
  // `unpack: false` (or null) turns a built-in game's unpacking off.
  if (out.unpack === false || out.unpack === null) delete out.unpack;
  if (out.unpack !== undefined && (out.method !== 'steamcmd' || !WORKSHOP_UNPACK.includes(out.unpack))) return null;
  if (out.branch !== undefined && !WORKSHOP_BRANCHES.includes(out.branch)) return null;
  for (const key of ['ids_variable', 'collection_variable']) {
    if (out[key] !== undefined && !WORKSHOP_VARIABLE.test(String(out[key]))) return null;
  }
  return Object.freeze(out);
}

// --- the other features --------------------------------------------------------------------------------------------

/** Tentacle's RCON clients (tentacle/src/rcon/index.js); `rcon: true` means `minecraft`. */
export const RCON_TYPES = Object.freeze(['source', 'webrcon', 'satisfactory', 'minecraft']);
/** Tentacle's player queries (tentacle/src/query/status.js). */
export const PLAYER_QUERY_TYPES = Object.freeze(['a2s', 'rcon_status']);
/** The Players tab: presets, list sources and actions (tentacle/src/players/index.js). */
export const PLAYERS_PRESETS = Object.freeze(['source', 'rust', 'pocketmine']);
export const PLAYERS_LISTS = Object.freeze(['a2s', 'rcon_status', 'webrcon', 'minecraft_query']);
export const PLAYERS_ACTIONS = Object.freeze(['kick', 'ban', 'unban', 'message', 'broadcast']);
const PLAYERS_PLACEHOLDERS = ['name', 'steamid', 'userid', 'reason', 'message'];
/** Idle sleep modes (shared/src/sleep.js). */
export const SLEEP_MODES = Object.freeze(['minecraft_java', 'minecraft_bedrock', 'tcp', 'udp']);
/** The console's terminal size limits (tentacle/src/server/container-spec.js). */
export const TTY_LIMITS = Object.freeze({ rows: [10, 500], cols: [40, 1000] });
/** Resource hints the game picker reads (web/src/pages/admin/game-picker.js). */
export const RESOURCE_HINTS = Object.freeze(['memory_mb', 'disk_mb']);
/** Features that are `true` or `false`. */
export const BOOLEAN_FEATURES = Object.freeze([
  'no_console_input',
  'tty_answers',
  'strip_ansi',
  'thunderstore',
  'startup_locked',
]);

/**
 * The egg's `rcon` feature as `{ type, port_var, password_var }` (the variables null when not given), or null when RCON
 * is off. `true` and an object without a `type` are `minecraft`: Minecraft's RCON is the Source protocol, and the
 * `minecraft` type only adds the server.properties fallback for a missing port or password, so a Source game without
 * a type still connects. Anything else (a string, an unknown type) is off rather than guessed: talking the wrong
 * protocol to a WebRCON or Satisfactory server only fails. Tentacle's rconSettings() reads the feature the same way.
 */
export function rconFeature(features) {
  const raw = features?.rcon;
  if (raw === true) return { type: 'minecraft', port_var: null, password_var: null };
  if (!isObj(raw)) return null;
  const type = raw.type ?? 'minecraft';
  if (!RCON_TYPES.includes(type)) return null;
  const name = (v) => (typeof v === 'string' && v ? v : null);
  return { type, port_var: name(raw.port_var), password_var: name(raw.password_var) };
}

/**
 * The variables the RCON connection reads: its port and password (`RCON_PORT` / `RCON_PASS` by default). The panel
 * keeps the password variable filled with a generated password (Satisfactory's token is kept elsewhere instead).
 */
export function rconVariables(features) {
  const rcon = rconFeature(features);
  if (!rcon) return { port: null, password: null };
  if (rcon.type === 'satisfactory') return { port: rcon.port_var, password: null };
  return { port: rcon.port_var ?? 'RCON_PORT', password: rcon.password_var ?? 'RCON_PASS' };
}

/**
 * The egg's idle sleep setting: a mode of SLEEP_MODES, `auto` (`true`, or `{}` without a mode: the mode is guessed from
 * the egg) or null (servers of the egg can't sleep). An unknown mode name is null, not a guess: a guessed TCP listener
 * for a UDP game would never wake, and `"no"` or `"false"` must not turn sleep on.
 */
export function sleepSetting(features) {
  const raw = features?.sleep;
  if (raw === true) return 'auto';
  if (typeof raw === 'string') return SLEEP_MODES.includes(raw) ? raw : null;
  if (!isObj(raw)) return null;
  if (raw.mode === undefined || raw.mode === null) return 'auto';
  return SLEEP_MODES.includes(raw.mode) ? raw.mode : null;
}

/**
 * The egg's `steam_login` flag as `{ required }`, or null when its servers don't use Steam logins: `true`, or an
 * object whose `required` is true, false or left out. Any other value (`"yes"`, `"false"`, `{ "required": "yes" }`) is
 * off, so a string can never turn on a feature that takes over the Steam variables.
 */
export function steamLogin(features) {
  const raw = features?.steam_login;
  if (raw === true) return { required: false };
  if (!isObj(raw) || (raw.required !== undefined && typeof raw.required !== 'boolean')) return null;
  return { required: raw.required === true };
}

/**
 * The egg's licence variable (`features.eula_variable: { env, accept }`): the variable that accepts the game's EULA or
 * licence and the value that accepts it. The panel sets it only while the `server_tools.auto_accept_eula` setting is on.
 * Null when the egg has none or it is malformed.
 */
export function eulaVariable(features) {
  const f = features?.eula_variable;
  if (!isObj(f) || typeof f.env !== 'string' || typeof f.accept !== 'string') return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,190}$/.test(f.env) || !f.accept || f.accept.length > 64 || /[\r\n\0]/.test(f.accept))
    return null;
  if (licenceClash(features, f.env)) return null;
  return { env: f.env, accept: f.accept };
}

/**
 * The panel overwrites the licence variable's value while it accepts licences: never a port variable, the RCON port,
 * the managed RCON password (also `RCON_PORT`/`RCON_PASS`, the defaults of `rcon: true`) or the Steam login, which
 * would all become the accept value (a crafted egg could pin a known RCON password).
 */
function licenceClash(features, env) {
  const rcon = rconVariables(features);
  return (
    (isObj(features?.port_vars) && Object.hasOwn(features.port_vars, env)) ||
    env === rcon.port ||
    env === rcon.password ||
    ['STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH'].includes(env)
  );
}

/** Problems with a Players tab action template (a command or a list of up to 4); null/false turns the action off. */
function playersTemplateProblem(action, value) {
  if (value === null || value === false) return null;
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
  const bad = `players.${action} must be a command or a list of up to 4 (placeholders {${PLAYERS_PLACEHOLDERS.join('}, {')}})`;
  if (!list?.length || list.length > 4) return bad;
  for (const c of list) {
    if (typeof c !== 'string' || !c.trim() || c.length > 512 || /[\r\n\0]/.test(c)) return bad;
    if ((c.match(/"/g) ?? []).length % 2) return `players.${action} has unbalanced quotes`;
    for (const [, key] of c.matchAll(/\{([a-z]+)\}/g))
      if (!PLAYERS_PLACEHOLDERS.includes(key)) return `players.${action} uses an unknown placeholder {${key}}`;
  }
  return null;
}

/**
 * Problems with the egg's features (as `eggFeatures` merges them). `envNames`: the egg's variables (after the
 * reserved-name renames). A feature with a problem is ignored, or partly ignored, by the panel and Tentacle.
 */
export function featureProblems(f, envNames = new Set()) {
  const p = [];
  const hasVar = (name) => envNames.has(name) || BUILTIN_VARS.has(name);
  if (f.port_vars !== undefined) {
    if (!isObj(f.port_vars)) p.push('features.port_vars must be an object');
    else
      for (const [name, spec] of Object.entries(f.port_vars)) {
        if (!envNames.has(name)) p.push(`port_vars: ${name} is not a variable of the egg`);
        if (parsePortSpec(spec) == null) p.push(`port_vars: ${name} must be "primary+N", not "${spec}"`);
      }
  }
  if (f.fixed_ports !== undefined) {
    if (!isObj(f.fixed_ports)) p.push('features.fixed_ports must be an object');
    else p.push(...fixedPortSpecs(f).invalid);
  }
  // Tentacle ignores a port readiness it can't use and waits for the done text alone.
  for (const w of readyPortSpec(f, envNames).invalid) p.push(`${w}; the start is detected from the console text only`);
  // An object without a type is `minecraft`, like `true` (see rconFeature).
  if (f.rcon !== undefined && f.rcon !== false) {
    if (!rconFeature(f))
      p.push(
        `features.rcon must be true or { type, port_var, password_var } (types ${RCON_TYPES.join(', ')}); RCON is off`,
      );
    else if (isObj(f.rcon))
      for (const k of ['port_var', 'password_var'])
        if (f.rcon[k] !== undefined && !hasVar(f.rcon[k]))
          p.push(`rcon.${k}: ${f.rcon[k]} is not a variable of the egg`);
  }
  if (f.player_query !== undefined && f.player_query !== false) {
    const q = typeof f.player_query === 'string' ? { type: f.player_query } : f.player_query;
    if (!isObj(q) || !PLAYER_QUERY_TYPES.includes(q.type))
      p.push(
        `features.player_query must be ${PLAYER_QUERY_TYPES.map((t) => `"${t}"`).join(' or ')} or { type, port_var }`,
      );
    else {
      if (q.port_var !== undefined && !hasVar(q.port_var))
        p.push(`player_query.port_var: ${q.port_var} is not a variable of the egg`);
      if (q.port_offset !== undefined && !isInt(q.port_offset, -100, 100))
        p.push('player_query.port_offset must be a whole number from -100 to 100');
    }
  }
  if (f.players !== undefined && f.players !== false && f.players !== true) {
    const o = typeof f.players === 'string' ? { preset: f.players } : f.players;
    if (!isObj(o)) p.push('features.players must be a preset name or an object');
    else {
      if (o.preset !== undefined && !PLAYERS_PRESETS.includes(o.preset))
        p.push(`players: the preset must be one of ${PLAYERS_PRESETS.join(', ')}`);
      if (o.list !== undefined && !PLAYERS_LISTS.includes(o.list))
        p.push(`players.list must be one of ${PLAYERS_LISTS.join(', ')}`);
      for (const a of PLAYERS_ACTIONS) {
        const problem = o[a] === undefined ? null : playersTemplateProblem(a, o[a]);
        if (problem) p.push(problem);
      }
    }
  }
  if (f.sleep !== undefined && f.sleep !== false && !sleepSetting(f))
    p.push(`features.sleep must be true, a mode (${SLEEP_MODES.join(', ')}) or { mode }; servers can't sleep`);
  if (f.resources !== undefined) {
    if (!isObj(f.resources)) p.push('features.resources must be an object');
    else
      for (const [k, v] of Object.entries(f.resources)) {
        if (!RESOURCE_HINTS.includes(k)) p.push(`resources has an unknown key "${k}" (${RESOURCE_HINTS.join(', ')})`);
        else if (!Number.isInteger(v) || v <= 0) p.push(`resources.${k} must be a positive whole number`);
      }
  }
  p.push(...installSandboxProblems(f.install_sandbox));
  if (f.steam_workshop !== undefined && f.steam_workshop !== false && !workshopGame({ features: f }))
    p.push(
      `features.steam_workshop must be a known game (${Object.keys(WORKSHOP_GAMES).join(', ')}) or a usable { app_id, method, … }`,
    );
  if (f.steam_login !== undefined && f.steam_login !== false && !steamLogin(f))
    p.push('features.steam_login must be true or { "required": true | false }; Steam logins are off');
  if (f.tty_size !== undefined) {
    if (!isObj(f.tty_size)) p.push('features.tty_size must be { rows, cols }');
    else
      for (const [k, [min, max]] of Object.entries(TTY_LIMITS))
        if (f.tty_size[k] !== undefined && !isInt(f.tty_size[k], min, max))
          p.push(`tty_size.${k} must be a whole number from ${min} to ${max}`);
  }
  if (
    f.crash_files !== undefined &&
    (!Array.isArray(f.crash_files) || !f.crash_files.every((c) => typeof c === 'string'))
  )
    p.push('features.crash_files must be a list of paths');
  for (const k of BOOLEAN_FEATURES)
    if (f[k] !== undefined && typeof f[k] !== 'boolean') p.push(`features.${k} must be true or false`);
  // `false` turns the maintenance broadcast off (tentacle/src/server/maintenance.js).
  if (f.broadcast_command !== undefined && f.broadcast_command !== false && typeof f.broadcast_command !== 'string')
    p.push('features.broadcast_command must be a command or false');
  if (f.eula_variable !== undefined) {
    const ev = eulaVariable(f);
    const env = isObj(f.eula_variable) ? f.eula_variable.env : null;
    if (!ev && typeof env === 'string' && licenceClash(f, env))
      p.push(`eula_variable.env: ${env} is a port, RCON password or Steam login variable, not a licence switch`);
    else if (!ev) p.push('features.eula_variable must be { env, accept } (a variable name and the value that accepts)');
    else if (!envNames.has(ev.env)) p.push(`eula_variable.env: ${ev.env} is not a variable of the egg`);
  }
  return p;
}

/**
 * The variables (imported env names) an egg marks secret although they are `port_vars`: a port is no secret, and the
 * panel writes those values itself (creation, transfers, rehomes), so they're always stored in clear. The importer
 * drops the flag on them.
 */
export function secretPortVariables(raw, features = eggFeatures(raw)) {
  if (!isObj(features?.port_vars)) return [];
  const xVariables = isObj(raw?.x_octail?.variables) ? raw.x_octail.variables : {};
  const out = [];
  for (const v of Array.isArray(raw?.variables) ? raw.variables : []) {
    const env = str(v?.env_variable).trim();
    const name = importedEnvName(env);
    if (!Object.hasOwn(features.port_vars, name)) continue;
    const flags = Object.hasOwn(xVariables, env) && isObj(xVariables[env]) ? xVariables[env] : {};
    if (isOn(v.secret) || isOn(flags.secret)) out.push(name);
  }
  return out;
}

/** The keys `x_octail` may have. */
export const X_OCTAIL_KEYS = Object.freeze(['category', 'features', 'pull_policy', 'variables']);
export const PULL_POLICIES = Object.freeze(['if_missing', 'always']);
/** Octail-only flags of a variable (`x_octail.variables.<ENV>`, or on the variable itself). */
export const VARIABLE_FLAGS = Object.freeze(['secret', 'multiline']);

/** `variableNames`: the env names as the document spells them (x_octail.variables is keyed by those). */
function xOctailProblems(x, variableNames = new Set()) {
  if (x === undefined || x === null) return [];
  if (!isObj(x)) return ['x_octail must be an object'];
  const p = [];
  for (const k of Object.keys(x)) if (!X_OCTAIL_KEYS.includes(k)) p.push(`x_octail has an unknown key "${k}"`);
  if (x.category !== undefined && (typeof x.category !== 'string' || !x.category.trim() || x.category.length > 64))
    p.push('x_octail.category must be a non-empty string of at most 64 characters');
  if (x.pull_policy !== undefined && !PULL_POLICIES.includes(x.pull_policy))
    p.push(`x_octail.pull_policy must be ${PULL_POLICIES.map((v) => `"${v}"`).join(' or ')}`);
  if (x.features !== undefined && !isObj(x.features)) p.push('x_octail.features must be an object');
  // Variable flags by env name: { "GIT_TOKEN": { "secret": true }, "MOTD": { "multiline": true } }.
  if (x.variables !== undefined) {
    if (!isObj(x.variables)) p.push('x_octail.variables must be an object with an object of flags per env name');
    else
      for (const [name, flags] of Object.entries(x.variables)) {
        if (!variableNames.has(name)) p.push(`x_octail.variables: ${name} is not a variable of the egg`);
        if (!isObj(flags)) {
          p.push(`x_octail.variables.${name} must be an object`);
          continue;
        }
        for (const [k, v] of Object.entries(flags)) {
          if (!VARIABLE_FLAGS.includes(k)) p.push(`x_octail.variables.${name} has an unknown key "${k}"`);
          else if (!isBoolish(v)) p.push(`x_octail.variables.${name}.${k} must be true or false`);
        }
      }
  }
  return p;
}

// --- the whole document --------------------------------------------------------------------------------------------

function parseMaybeJson(value) {
  if (value === '') return { value: null };
  if (typeof value !== 'string') return { value };
  try {
    return { value: JSON.parse(value) };
  } catch {
    return { error: true };
  }
}

/**
 * Checks one parsed egg document against the format. Returns `{ errors, warnings }`, both lists of messages:
 *   - errors: the panel can't import the egg (no images, no startup command, unusable config files or variables, …);
 *   - warnings: it imports, but part of it is ignored or renamed (unknown rules, malformed Octail features, …).
 */
export function eggFormatProblems(raw) {
  const errors = [];
  const warnings = [];
  if (!isObj(raw)) return { errors: ['the file is not an egg document (a JSON object)'], warnings };
  const format = raw.meta?.version;
  if (!EGG_FORMATS.includes(format)) {
    errors.push(
      `unrecognised format: meta.version ${JSON.stringify(format ?? null)} must be one of ${EGG_FORMATS.join(', ')}`,
    );
    return { errors, warnings };
  }
  if (!str(raw.name).trim()) warnings.push('name is missing');
  if (raw.description != null && typeof raw.description !== 'string') warnings.push('description must be a string');
  const url = raw.meta?.update_url;
  if (url != null && url !== '' && (typeof url !== 'string' || !url.startsWith('https://')))
    warnings.push('meta.update_url must be an https:// URL');

  // Images.
  const images = eggImages(raw);
  let usable = 0;
  for (const [label, ref] of Object.entries(images)) {
    if (typeof ref === 'string' && ref.trim()) usable++;
    else warnings.push(`docker_images["${label}"] has no image and is left out`);
  }
  if (usable === 0) errors.push('docker_images must be a non-empty object of display names and images');

  // Startup.
  const startups = eggStartupCommands(raw);
  if (Object.keys(startups).length === 0) errors.push('there is no startup command');
  else
    for (const [name, cmd] of Object.entries(startups))
      if (typeof cmd !== 'string' || !cmd.trim()) warnings.push(`startup command "${name}" is empty`);

  // Config.
  const config = isObj(raw.config) ? raw.config : {};
  if (raw.config != null && !isObj(raw.config)) warnings.push('config must be an object; it is ignored');
  if (config.extends)
    errors.push(
      `it extends another egg ("${config.extends}"), which isn't supported; import the base egg's settings instead`,
    );
  const files = parseMaybeJson(config.files);
  if (files.error) errors.push('config.files is not valid JSON');
  else if (files.value != null && !isObj(files.value))
    errors.push('config.files must be an object of file names, each { parser, find }');
  else
    for (const [file, spec] of Object.entries(files.value ?? {}))
      if (!isObj(spec) || !spec.parser) errors.push(`config file "${file}" has no parser`);
  const startup = parseMaybeJson(config.startup);
  if (startup.error) errors.push('config.startup is not valid JSON');
  if (parseMaybeJson(config.logs).error) warnings.push('config.logs is not valid JSON');
  if (config.stop != null && typeof config.stop !== 'string') warnings.push('config.stop must be a string');

  // Variables.
  const envNames = new Set();
  const documentNames = new Set();
  if (raw.variables != null && !Array.isArray(raw.variables)) errors.push('variables must be a list');
  for (const [i, v] of (Array.isArray(raw.variables) ? raw.variables : []).entries()) {
    const env = str(v?.env_variable).trim();
    const label = `variable ${env || `#${i + 1}`}`;
    if (!ENV_NAME.test(env)) {
      errors.push(`${label} has an invalid env name ${JSON.stringify(v?.env_variable ?? null)}`);
      continue;
    }
    documentNames.add(env);
    const name = importedEnvName(env);
    if (name !== env) warnings.push(`variable ${env} is reserved by Octail; renamed to ${name}`);
    if (envNames.has(name)) {
      errors.push(`variable ${name} is defined twice`);
      continue;
    }
    envNames.add(name);
    if (!str(v.name).trim()) warnings.push(`${label} has no name`);
    for (const k of ['user_viewable', 'user_editable', ...VARIABLE_FLAGS])
      if (v[k] !== undefined && v[k] !== null && !isBoolish(v[k]))
        warnings.push(`${label}: ${k} must be true or false`);
    for (const r of ruleProblems(v.rules)) warnings.push(`${label}: ${r}`);
  }

  // Install script.
  const inst = raw.scripts?.installation;
  if (inst?.script && !String(inst.container ?? '').trim()) errors.push('the install script has no container image');

  // Octail's additions.
  warnings.push(...xOctailProblems(raw.x_octail, documentNames));
  const features = eggFeatures(raw);
  warnings.push(...featureProblems(features, envNames));
  for (const name of secretPortVariables(raw, features))
    warnings.push(`variable ${name} is a port variable (port_vars), which can't be secret; the secret flag is ignored`);
  return { errors, warnings };
}
