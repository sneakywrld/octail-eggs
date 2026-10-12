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
  keys nobody needs to read back are also marked write-only (`x_octail.variables`: `{ "GIT_TOKEN": { "secret": true } }`).
- **`x_octail`** (Octail's additions) stays well formed: category, extra ports (`port_vars`), RCON, players, sleep,
  resource hints, variable flags (`secret`, `multiline`). Other panels ignore it.
- Credit the upstream egg in `_comment` when the egg is derived from one (see `NOTICE.md`).

## Checking an egg

The validator has no dependencies (Node.js 20 or newer). It runs the egg format rules of the Octail panel's importer
(`tools/egg-format.mjs` is the panel's own file), so an egg it passes imports without warnings:

```bash
node tools/validate.mjs                              # every egg in the repository
node tools/validate.mjs --forbid-upstream-images     # as CI runs it
```

Then import it on an Octail panel (Admin → Eggs → Import eggs → **Web address** with the raw URL of your fork's file,
or `octail egg:import <raw url>`), install a server with it and start it.

## Licence

Most eggs are derived from [pelican-eggs](https://github.com/pelican-eggs) eggs under the MIT licence (see
`NOTICE.md`). A licence for Octail's own additions hasn't been chosen yet; by contributing you agree that your change
may be published under the licence the owner chooses.
