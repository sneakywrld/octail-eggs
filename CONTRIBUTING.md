# Contributing to octail-eggs

Thanks for helping. The quickest way to get an egg fixed or added is an
[issue](https://github.com/sneakywrld/octail-eggs/issues/new/choose): the templates ask for what we need.

## Where eggs are edited

This repository is **generated**. The eggs live in the `eggs/` folder of the Octail panel repository and are
published here by `scripts/eggs/build-repo.mjs`, which also writes the READMEs, `NOTICE.md`, `CHANGELOG.md` and the
validation workflow. A direct change here is overwritten by the next publish.

Pull requests are still welcome: they show exactly what you mean, and CI validates them. A maintainer applies the change
to the panel repository's `eggs/` folder by hand, tests it on an Octail node, and it comes back here with the next
publish (so the pull request is closed rather than merged, and the commit lands with a different hash). Please say in
the pull request what you tested.

## What a good egg change looks like

- **Paths never move.** `<folder>/<egg>.json` is the update address of every panel that imported the egg. Rename
  nothing; a new egg gets a new file.
- **Our images only.** `docker_images` and the install container use
  [octail-yolks](https://github.com/sneakywrld/octail-yolks) tags (`ghcr.io/sneakywrld/octail-yolks:<tag>`); images
  from Pterodactyl, Pelican or parkervcp are refused by the validator. If a game needs something no tag has, open an
  [image request](https://github.com/sneakywrld/octail-yolks/issues/new/choose) there.
- **Install scripts** download over `https://`, retry SteamCMD downloads (`for steamcmd_try in 1 2 3; do`), and exit 1
  when the server binary is missing afterwards, so a failed install isn't reported as a success.
- **Variables** have a description, a sensible default and valid rules (`required|string|max:64`, `nullable|integer`,
  ...). Secrets are named so the startup line masks them (`*_PASSWORD`, `*_TOKEN`, `*_KEY`, ...); access tokens and
  keys nobody needs to read back are also marked write-only (`x_octail.variables`: `{ "GIT_TOKEN": { "secret": true } }`). A port variable
  (`port_vars`) is never secret: the panel ignores the flag on one.
- **`x_octail`** (Octail's additions) stays well formed: category, extra ports (`port_vars`), RCON, players, sleep,
  resource hints, variable flags (`secret`, `multiline`). Other panels ignore it.
- Credit the upstream egg in `_comment` when the egg is derived from one (see `NOTICE.md`).

## Checking an egg

The tools in `tools/` have no dependencies (Node.js 20 or newer). The validator runs the egg format rules of the
Octail panel's importer (`tools/egg-format.mjs` is the panel's own file), so an egg it passes imports without
warnings, then this repository's policy and the lint rules below:

```bash
node tools/validate.mjs                              # every egg in the repository
node tools/validate.mjs --forbid-upstream-images     # as CI runs it
node tools/validate.mjs --strict                     # warnings fail too
node tools/validate.mjs --quiet                      # problems only, no warnings
node tools/validate.mjs --json                       # { eggs, problems, warnings } for scripts
node tools/format.mjs --check                        # every egg formatted the way the generator writes it
node tools/format.mjs --write                        # ... and fix the ones that aren't
```

Then import it on an Octail panel (Admin → Eggs → Import eggs → **Web address** with the raw URL of your fork's file,
or `octail egg:import <raw url>`), install a server with it and start it.

### Lint rules

`tools/egg-lint.mjs` catches mistakes the egg format allows but that make a server misbehave. Every finding names its
rule in brackets. An **error** fails the check; a **warning** is reported (and shown on the file in pull requests)
but doesn't fail, because there are legitimate reasons for it. Say in your pull request why a new warning is fine.

| Rule                         | Level   | What it catches                                                                                                                                                                                                                    |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image-not-yolks`            | error   | an image or the install container that isn't `ghcr.io/sneakywrld/octail-yolks:<tag>`                                                                                                                                               |
| `image-unknown-tag`          | error   | an octail-yolks tag that isn't built (the list is `tools/yolks-tags.txt`; a dated `<tag>-<yyyymmdd>` counts as its tag)                                                                                                            |
| `stop-missing`               | error   | no stop command (`config.stop`): the panel could only kill the server. Use `^C` to send SIGINT                                                                                                                                     |
| `startup-undefined-variable` | error   | the startup line uses `{{NAME}}` but the egg has no variable `NAME` (the server's own `SERVER_PORT`, `SERVER_IP`, `SERVER_MEMORY`, … are fine)                                                                                     |
| `default-breaks-rules`       | error   | a variable's default fails its own rules: not in its `in:` list, doesn't match its `regex:`, not an `integer`, longer than `max:`, …                                                                                               |
| `insecure-download`          | error   | the install script turns TLS checks off (`curl -k`, `curl --insecure`, `wget --no-check-certificate`)                                                                                                                              |
| `done-missing`               | warning | no ready text (`config.startup.done`) and no port readiness (`x_octail.features.ready`): the server never shows as started                                                                                                         |
| `variable-unused`            | warning | a variable that neither the startup line, the install script, a config file nor a feature reads. Variables our images read themselves (`SRCDS_APPID`, `AUTO_UPDATE`, `WINEDEBUG`, …) count as read; others may be read by the game |
| `required-without-default`   | warning | a required variable with an empty default: every new server needs a value typed in. Port variables and secrets the panel generates are exempt                                                                                      |
| `port-not-in-startup`        | warning | a port variable (`port_vars`) that neither the startup line nor a config file passes to the game (fine when the game derives the port itself)                                                                                      |
| `download-without-checksum`  | warning | the install script downloads from a source that publishes checksums (GitHub release digests, Mojang, PaperMC, Adoptium, Modrinth) but checks none                                                                                  |

Downloads over `http://` are refused by the validator itself (with the other policy checks listed at the top of
`tools/validate.mjs`).

### Formatting

Every egg is `JSON.stringify(egg, null, 2)` with a final newline (UTF-8 without a byte order mark, LF line ends),
exactly as the generator writes it, so a diff shows only what changed. `node tools/format.mjs --write` fixes a file.

## Continuous integration

Two workflows run here (both use only the workflow's own `GITHUB_TOKEN`, read-only unless a job needs more, with every
action pinned to a commit SHA):

- **Validate eggs** (`.github/workflows/validate.yml`), on every push and pull request: the validator with
  `--forbid-upstream-images --github` (errors fail the run; errors and warnings show as annotations on the files),
  then `node tools/format.mjs --check`.
- **Check upstream versions** (`.github/workflows/check-updates.yml`), every Monday and on demand: runs
  `tools/check-updates.mjs` and keeps one issue, **Outdated eggs (upstream versions)**, up to date: opened when a pinned
  version is behind, its table replaced on each run, closed once every pin is current again. Pins whose upstream
  couldn't be reached are listed as unknown and never open the issue on their own.

## Upstream versions

Some eggs pin a version together with its checksum, so an install can't be swapped for something else: a GitHub release
(Red Eclipse, OldUnreal's Unreal Tournament patches), a Jenkins build (Spigot's BuildTools), a Steam Runtime snapshot
(Zombie Panic! Source), ContentDB packages (Luanti's games), Xonotic. `tools/check-updates.mjs` compares each pin with
the upstream source the egg already downloads from and prints a table:

```bash
node tools/check-updates.mjs                         # egg, pin, pinned, latest, status
node tools/check-updates.mjs --json                  # the same rows as JSON
node tools/check-updates.mjs --markdown report.md    # the issue body CI posts
node tools/check-updates.mjs --fail-on-outdated      # exit 1 when a pin is behind
```

It needs no API key (a `GITHUB_TOKEN` in the environment raises the GitHub API rate limit when set) and tolerates
network failures: a source that doesn't answer makes its pins "unknown", nothing else. Release candidates and previews
only count as newer when the pinned version is one too. What it reads as a pin:

- a GitHub release download (`https://github.com/<owner>/<repo>/releases/download/…${VERSION}…/`) whose version
  variable holds a literal, or reads an egg variable's default (`VERSION="${XONOTIC_VERSION:-0.8.6}"`);
- a Jenkins job URL (`…/job/<Name>`) next to a `<NAME>_BUILD` variable with a build number;
- `repo.steampowered.com/steamrt-images-<branch>/snapshots/${VERSION}`;
- `<NAME>_URL=https://cdn.content.luanti.org/uploads/<file> # <Title> <version>` (Minetest Game, VoxeLibre);
- `dl.xonotic.org/xonotic-${VERSION}`;
- a `MINECRAFT_VERSION` default that is a release number, in an egg reading Mojang's version manifest or the PaperMC
  API.

To bump a pin: change the version and its checksum together (from the upstream's published checksum where there is
one, else the SHA-256 of the file you checked), install a server with the egg, and say what you tested. For Luanti's
games, the release must also support the Luanti version the image's Alpine ships (`min_minetest_version`).

## Licence

Most eggs are derived from [pelican-eggs](https://github.com/pelican-eggs) eggs under the MIT licence (see
`NOTICE.md`). A licence for Octail's own additions hasn't been chosen yet; by contributing you agree that your change
may be published under the licence the owner chooses.
