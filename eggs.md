# The Octail eggs: what they are and how they got here

This file is the long-form history of this repository: what an egg is, the rules every egg here follows, where the
numbers stand, and a changelog of all egg work so far, newest first. The [README](README.md) is the index you browse;
[TESTED.md](TESTED.md) has each egg's last real run; [CHANGELOG.md](CHANGELOG.md) is the generated per-publish list of
files added, changed and removed. The container images the eggs run on have their own history in
[octail-yolks' yolks.md](https://github.com/sneakywrld/octail-yolks/blob/main/yolks.md).

- [What an egg is](#what-an-egg-is)
- [The format](#the-format)
- [The rules every egg here follows](#the-rules-every-egg-here-follows)
- [Where things stand](#where-things-stand)
- [Changelog](#changelog)
- [Every shipped egg](#every-shipped-egg)

## What an egg is

An egg is one JSON (or YAML) document that tells a game-server panel how to run one kind of server: which container
images it may use, how to install it (a shell script run once in an installer image), the startup command, the
variables a server owner can change, which config files to edit before every start, and how to tell that the server
has finished starting. The format comes from Pterodactyl and Pelican; Octail reads theirs and adds its own section.

The eggs here are the ones [Octail](https://github.com/sneakywrld/octail-panel) ships. Their source of truth is the
`eggs/` folder of the Octail panel repository; this repository is regenerated from it on every publish, one folder per
category, with each egg's `meta.update_url` pointing at its own raw file here. A panel that imported an egg from here
checks that address for updates (Admin, Eggs, Check for updates), so published paths never change.

Many eggs started as copies of [pelican-eggs](https://github.com/pelican-eggs) eggs (MIT, see [NOTICE.md](NOTICE.md)),
pinned to a known commit and then reworked; a growing share are Octail's own. Either way, an egg is only shipped once it
installs and runs on Octail's own images.

## The format

- **Pterodactyl and Pelican formats are accepted.** The panel's importer reads `PTDL_v1`, `PTDL_v2` and `PLCN_v1` to
  `PLCN_v3`, as JSON or YAML, and follows Pelican's conversion rules (rule arrays, reserved variable renames, config
  paths). It exports `PTDL_v2`, `PLCN_v3` and Octail's own format, and the round trip is tested.
- **Octail's extensions live under `x_octail`**, which other panels ignore and which survives import and export:
  the category, port variables (`port_vars`: query, RCON and beacon ports the panel allocates per server instead of
  fixed defaults that clash on one node), `fixed_ports` (ports a game opens at a fixed offset, such as Pavlov VR's
  status port at +400), RCON (`rcon`: Source, Minecraft, WebRCON, Factorio, Satisfactory's API), player lists
  (`player_query`, `players`), idle sleep, broadcast commands, port readiness (`ready`: the server counts as started
  once its game port is bound), `steam_login`, `eula_variable`, write-only (`secret`) and multi-line variables, resource
  hints, install sandbox settings and the server tools an egg offers (mod and plugin browsers, version changers,
  Steam Workshop, Thunderstore, Rust wipes).
- **One rule set.** Since 2026-10-12 the panel's importer and this repository's standalone checker
  (`tools/validate.mjs`) run the same file, `tools/egg-format.mjs` (`shared/src/egg-format.js` in the panel), so both
  give the same verdict. The CI workflow here runs it on every push and pull request.
- `tested.json` in the panel's `eggs/` folder is not an egg: it records each egg's last real run and is turned into
  [TESTED.md](TESTED.md) and the Tested column of the README tables.

## The rules every egg here follows

- **Our own images only.** Every egg runs and installs on `ghcr.io/sneakywrld/octail-yolks:<tag>`, built from official
  upstream bases only. No egg uses a `ghcr.io/pterodactyl`, `ghcr.io/pelican-eggs` or `ghcr.io/parkervcp` image: the
  panel's tests check it and the workflow here refuses them. Since 2026-10-19 the panel can also enforce this for every
  server (`servers.allowed_images`, octail-yolks only by default; foreign images in imports are mapped to their
  octail-yolks replacement).
- **Checked downloads.** Every install download goes over HTTPS, and where a project publishes a strong checksum
  (SHA-256, SHA-512, Mojang's SHA-1) the install script checks it and fails on a mismatch; where none is published,
  the script pins the hash of a file we downloaded. What can't be verified is listed in the panel's `eggs/README.md`:
  Purpur (MD5 only), BungeeCord (no checksum), Pufferfish (no checksum; two builds pinned) and Valve's SteamCMD bootstrap
  tarball (no checksum; SteamCMD then updates itself from Steam, which Steam checks).
- **Installs fail loudly.** Every SteamCMD install retries its download up to three times (a fresh SteamCMD fails its
  first `app_update` with "Missing configuration") and fails when the server binary isn't there afterwards, instead of
  "installing" an empty folder. Installs never wait on a prompt (the node gives them no input; eggs stage big downloads
  on the server disk rather than the install `/tmp`).
- **No EULA is accepted for you.** Shipped eggs never accept a game's EULA or licence by default: the Minecraft Java eggs
  ask in the console, and eggs with a licence variable (TeamSpeak 3, SCP: Secret Laboratory, PowerNukkitX, Unreal
  Tournament 99 and 2004 with Epic's terms) leave it unset. A host who wants it can switch on the panel setting
  `server_tools.auto_accept_eula` (off by default), which writes `eula=true` and sets those variables on the host's
  behalf and logs it.
- **Accounts and tokens are the owner's.** Eggs whose server can't be downloaded anonymously use a logged-in Steam
  account (`steam_login`: Arma 3, DayZ, Starbound, Assetto Corsa, Killing Floor); Hytale's owner signs in on the first
  start. Game server tokens (CS2 and Unturned GSLTs, Don't Starve Together's cluster token, BeamMP's AuthKey, the
  optional GSLTs of the Source games) are asked for, never shipped. Every token-like variable is write-only: stored
  encrypted, never sent back to the browser, masked in the console's startup line (a test keeps it that way).
- **Neutral defaults.** No egg names another panel or host in its default settings (a test checks it).
- **Stops that save.** Servers get the stop signal or console command that makes them save (Ctrl+C trapped and handed to
  Wine and Proton servers, SIGTERM where the game needs it).

## Where things stand

Numbers as of 2026-10-24, after every egg that could run had a turn on vm1.

**158 eggs** in 13 folders:

| Folder        | Eggs | Folder      | Eggs |
| ------------- | ---: | ----------- | ---: |
| `steam/`      |   65 | `ark/`      |    2 |
| `minecraft/`  |   23 | `valheim/`  |    2 |
| `standalone/` |   23 | `voice/`    |    2 |
| `source/`     |   16 | `rust/`     |    1 |
| `apps/`       |   12 | `steamcmd/` |    1 |
| `goldsrc/`    |    7 | `testing/`  |    1 |
| `terraria/`   |    3 |             |      |

**Smoke status** from `tested.json` (the last real run on one of our nodes: install, ready line, a console command,
stop):

| Result     | Eggs | Meaning                                                                                                                   |
| ---------- | ---: | ------------------------------------------------------------------------------------------------------------------------- |
| `pass`     |  143 | ran on an octail-yolks image                                                                                              |
| `untested` |    0 | not yet run on octail-yolks                                                                                               |
| `blocked`  |   15 | can't be run yet: needs a token, a Steam account, the EULA, a port pair, game data files, or upstream to fix its download |
| `fail`     |    0 | none                                                                                                                      |

## What's left

- **Needs something we don't have** (`blocked`):
  - a Steam account that owns the game: Arma 3, Assetto Corsa, DayZ, Killing Floor, Starbound, Stormworks;
  - a token or id: ASKA (Steam game server login token), BeamMP (AuthKey), Don't Starve Together (Klei cluster
    token), Hytale (an account that owns it), Red-DiscordBot (a Discord bot token), RuneScape: Dragonwilds (the owner's
    Player ID);
  - game data files: OpenRCT2 (the original RollerCoaster Tycoon 2 files);
  - node ports in pairs: Pavlov VR (the main port and the main port + 400);
  - upstream: Risk of Rain 2 (Steam's public branch of the server carries an empty depot).

## Changelog

Newest first. Dates are when the work landed in the panel repository; "round" is the batch of parallel work it came in.

### 2026-10-25: the last three, and the panel's copies

**143 of 158 eggs pass**, none fail, none untested; the other 15 are `blocked` (see "What's left").

- **Counter-Strike 2** passed on vm1 with the owner's OK for its size: 31 min to install, 70 GB on disk (the 80 GB
  hint holds), ready in 29 s.
- **Palworld** and **Satisfactory** passed once their panel copies had the SteamCMD retry fix (both install in under
  two minutes).
- **The panel's own copies** of every egg were compared with the shipped files through the panel's importer: 77 still
  had the old SteamCMD retry loop (Palworld, Satisfactory and Valheim among them, which live servers use; the install
  script only runs on a reinstall), Arma Reforger's old ready line, ASKA's optional token and Stormworks' old app id.
  They were updated from the shipped files; all 130 match now.

### 2026-10-24 (later): one egg at a time on vm1, and what that found

With the test node gone, every egg that hadn't passed yet ran on vm1's Production node one at a time: never past
the node's real free disk and memory, the disk trimmed after each one so the deleted test server's space goes back.
**140 of 158 eggs pass** now (111 this morning), none fail; 15 wait for an account, a token or upstream and 3 for the
reasons under "What's left".

- **SteamCMD retries never retried.** SteamCMD exits 0 even after `ERROR! Failed to install app … (Missing
configuration)`, so every egg's three-attempt loop stopped after the first failed run and the install then failed on
  its own file check (Satisfactory did, on vm1). A run now counts only when SteamCMD printed its own `Success! App`
  line and no `ERROR! Failed to install app` (87 eggs; the GoldSrc eggs already checked their files).
- **Arma Reforger** "didn't install" for a customer on 2026-10-22: those installs ran on the old test node while its
  disk was 8 GB, and the same egg installed on Production. A run on vm1 found the real problem: the server counted as
  started on `Starting RPL server`, which comes before the scenario has loaded, and it ignores Stop until the world
  runs (killed after 120 s). It's ready on `SCR_BaseGameMode::OnGameStateChanged = GAME` now; Stop saves and stops it
  in about 3 s. Passes.
- **SteamCMD (generic)**: its install stopped at once (`set -e` and a `chown` that reached the read-only install
  script). Passes since.
- **Windrose** ignores Ctrl+C under Proton: the stop waits up to 30 s, then SIGTERM (as Astroneer). Passes since.
- **ASKA** failed when it opened its session (`String.Remove` in `_WriteServerSaveId`): it looks for Windows line ends
  in its properties file, and both the install and Tentacle's config editor wrote it with LF. The install keeps it CRLF
  now, and Tentacle's `file`, `properties` and `ini` editors keep any CRLF file CRLF. Then the session needed a Steam
  game server login token: the Authentication Token is required now, and ASKA waits for one.
- **Operation: Harsh Doorstop** was up but never counted as started: it had no ready line and its Steam socket isn't
  seen as a bound UDP port. It's ready on the engine's `(Engine Initialization) Total time` now. Passes.
- **Team Fortress 2 Classified**, the one failing egg, passes with room on the disk (22 GB).
- **Hints from real runs**: The Front peaked at 8.2 GB (memory hint 10 GB now), Holdfast filled its 10 GB disk hint
  with the install alone (14 GB), Squad 44's download outgrew 20 GB (33 GB installed, hint 40 GB), CS2's outgrew 60 GB
  (hint 80 GB).
- **Stormworks** needs a Steam account that owns the game (above).
- **Blocked on something we don't have**: RuneScape: Dragonwilds (the owner's Player ID), Red-DiscordBot (a Discord bot
  token), ASKA (a Steam game server token).
- **Install progress**: Tentacle now reads how far an install is (SteamCMD's own percent and bytes, and its steps:
  queued, getting the image, starting, downloading, verifying, finishing) and the panel shows a page of its own while a
  server installs. Modpack installs show their step and files on every tab of the server.
- **Modpacks** that switch Minecraft version finish now (the install waited for the loader's jar swap without asking
  the node and gave up after 30 minutes), and a server moves to the Java its Minecraft version runs on when a version
  change or a modpack install finishes (Cobblemon for 1.21.1 refused the Java 25 a 26.2 server had). Cobblemon installs
  in 20 s on vm1 and starts with its 113 mods.

### 2026-10-24: the round 30 eggs on real nodes

Three smoke batches ran this round's eggs end to end (install, ready line, a console command, stop): 111 eggs now pass
on our own images, up from 59. What they found and what changed:

- **Ballistic Overkill** never applied its settings: the game reads only `config.txt` (no `-configfile` option), so
  the panel-managed `octail-config.txt` is copied over it at every start; the 64-bit `steamclient.so` now comes first
  on the library path (the 32-bit one stopped Steam from starting); it's ready on "HOST server ready" or its query port
  (the game port is never bound). Passes since.
- **Astroneer** ignores Ctrl+C under Proton: the stop waits up to 30 s, then sends SIGTERM. Passes since.
- **Eco** ignored `exit` typed into its console under Tentacle; its stop is now Ctrl+C, on which it saves and shuts
  down in about 20 s. Passes since.
- **Stormworks** needs a Steam account now: its free server tool (app 1247090) became a stub that only says the server
  has moved into the base game. The egg downloads the game (app 573090, Windows) with a Steam account that owns
  Stormworks (`steam_login`, required); the disk hint grows to 16 GB.
- **Rust and Satisfactory** got memory and disk hints (8 GB / 20 GB and 12 GB / 20 GB).
- **The app eggs** (Node.js, Python, Go, Bun, Deno) pass with a small test app uploaded before the start.
- **Team Fortress 2 Classified** still fails: SteamCMD ran out of disk on the test node. It needs its 40 GB.
- **The test harness** never sizes a test server past a node's real free disk and memory any more (10 GB or 15 % of
  the disk and 2 GB of memory kept free, and a watchdog that stops the batch when a node runs low). A batch sized by
  the panel's numbers alone filled a test node's disk, and that node is gone. 17 of the largest Steam games (Pavlov VR
  onwards) are still waiting for a node with room.

### 2026-10-23: every egg reviewed, 29 new eggs, automatic checks (round 30)

Twenty parallel reviews went through every shipped egg, group by group, and a few more added new ones. What changed:

- **Minecraft Java**: a new **Vanilla** egg (Mojang's own server from the version manifest, SHA-1 checked twice;
  snapshots only when asked for). **Paper** had the raw upstream script: it could match build 12 when asked for build
  1, fell back to variables it never set and checked nothing; it now uses the checked script of the Folia egg
  (SHA-256, a missing version or build fails the install). **Fabric** gave Java the whole memory limit as heap and
  ignored the jar name; it now starts like the other eggs and checks the installer and the Mojang jar. **Forge** checks
  its installer and survives a reinstall after a switch on the Version tab; **NeoForge** maps versions to Minecraft
  versions exactly (it used to pick 1.21.11's build for 1.21.1) and checks its installer.
- **Proxies and Bedrock**: **Velocity** got the same checked install as Paper, and the Velocity Version variable is
  finally used. **Bedrock**'s install checks the zip (Content-MD5, a test unzip, the server binary). **PowerNukkitX**
  crashed at every start on a one-CPU server: its registries load in parallel on a pool sized to the CPUs Java sees,
  and with one CPU they load in the wrong order. The start now tells Java it has at least four. New: **NanoLimbo** (a
  limbo server), **Gate** (a Go proxy) and **Cuberite** (a C++ server for 1.8 to 1.12.2 clients).
- **Source and GoldSrc**: **Counter-Strike 2**'s game server token is optional (without one the server isn't listed),
  **Team Fortress 2** has a max-players setting and a 35 GB disk hint (20 GB was too small for its staged download;
  the same was behind TF2 Classified's failure), **Garry's Mod** no longer passes an empty account token, and every
  SteamCMD download in these eggs retries with a time limit and the install checks the game folder.
- **Survival games**: **Palworld**'s settings parser is pinned to one release with its SHA-256 (it fetched the latest
  release unchecked), a reinstall keeps `PalWorldSettings.ini`, and restart warnings reach players. **Unturned** runs
  without a token (LAN mode, joinable by address). **Project Zomboid**'s player limit works. **Don't Starve Together**
  writes a changed cluster token before every start. **ARK: Survival Ascended** saves the world before it stops.
  **Conan Exiles** and **Eco** got broadcast commands for restart warnings. **Astroneer** and **Craftopia** already
  wait on their game port (their failures were from runs before that existed) and need a new run.
- **Shooters and simulators**: **Insurgency: Sandstorm** passes its tokens only when set, **Mordhau** has a broadcast,
  **Holdfast**'s config edit can't silently miss, **Pavlov VR** says exactly which port pair it needs, and **Risk of
  Rain 2** says why it can't install (Steam's public branch of the dedicated server has been empty since 2025-11).
- **Open-source and classic games**: **Factorio** checks its download against factorio.com's SHA-256 list (the old
  script checked nothing and overwrote `map-settings.json` on a reinstall), **Terraria** downloads a pinned version
  directly, **tModLoader** checks GitHub's digest, **OpenRCT2** says plainly when the game data is missing, and
  **Hytale** walks the owner through signing in.
- **New eggs**: VEIN, FOUNDRY, Smalland, Nightingale, RuneScape: Dragonwilds and Windrose (survival); ET: Legacy,
  Warfork, Operation: Harsh Doorstop, Ballistic Overkill and Chivalry: Medieval Warfare (shooters); Teeworlds,
  AssaultCube, TES3MP, OpenRA, SuperTuxKart and Unvanquished (open source, checked release downloads); Lavalink,
  Red-DiscordBot, Uptime Kuma, MariaDB, PostgreSQL and Valkey (bots, monitoring and databases); Bun and Deno apps.
- **App eggs**: Node.js 24, Python 3.13 and 3.14, Go 1.26 and 1.27 are offered (the newest LTS is the default); a
  Python app rebuilds its virtual environment when the Python version changes.
- **Checks on every push**: lint rules (`tools/egg-lint.mjs`: unknown images, missing stop commands, variables the
  startup uses but nobody defines are errors; unused variables and downloads without a checksum are warnings), a
  format check, and a weekly comparison of every pinned version with upstream that keeps one "Outdated eggs" issue up
  to date. The README now opens with statistics and a table of every game with its last real run.

### 2026-10-20 to 2026-10-21: real kick, ban and unban on more games

A round of Players-tab work, checked by hand against real downloaded servers rather than guessed command syntax:

- **Palworld**: player list, kick, ban and unban over Palworld's REST API (Palworld deprecated RCON for player
  management). The egg allocates a REST API port next to the game port and turns the API on in
  `PalWorldSettings.ini` before every start; only the node reaches that port.
- **Factorio**: `/players online`, `/kick`, `/ban`, `/unban` over RCON. Factorio's RCON doesn't answer the end-of-reply
  marker other Source-RCON servers do, so it got its own RCON type; its console ignores quotes, so names go in bare.
- **Conan Exiles**: `listplayers`, kick, ban, unban and broadcast over RCON.
- **7 Days to Die**: kick and a 100-year ban (the game's closest to permanent) over its telnet admin console. No unban:
  the game's `ban remove` throws for a plain player name.
- **ARK: Survival Evolved, ARK: Survival Ascended and PixARK**: `ListPlayers`, kick, ban and unban by SteamID64 over
  RCON. ARK: Survival Ascended now gets its own RCON port per server (game port + 3) like Evolved instead of one shared
  default. Checked on a real Evolved server; Ascended and PixARK are expected to answer the same commands but weren't
  checked on their own. No broadcast: ARK's chat commands couldn't be confirmed on a real server.
- **Eco**: kick, ban, unban and broadcast over RCON (Eco separates arguments with commas, not spaces).
- **Mordhau and Starbound**: kick and ban added to their existing RCON player lists.
- **Terraria TShock**: list, kick, ban and broadcast over TShock's REST API. The install seeds a panel-managed account
  into TShock's database, because TShock has no accounts until someone runs `/setup` in a game client. No unban (its
  endpoint wants a ban ticket number) and no private message.

Where a game's per-player list row couldn't be observed with a real connected player (Eco, the ARK family, Conan
Exiles, Factorio's non-empty list), the parser follows the documented or widely reported format and the code says so.
The idTech3 games (OpenArena, Urban Terror) stay without a Players tab: a real server didn't answer any UDP query in
our test environment.

### 2026-10-20: security re-audit

- Paper and Velocity no longer run their download-path template through `eval`; the five variables that can appear in
  it are substituted explicitly.
- The panel drops regex rules with catastrophic backtracking (`(x+)+` and similar) from imported eggs' variables, so a
  third-party egg can't slow the panel down with a customer's input.

### 2026-10-18 to 2026-10-19: tools, stops and the image policy (round 29)

- Modpack tools on every Java Minecraft server (Paper, Purpur, Folia, Leaf, Vanilla and Quilt too; a pack switches the
  server to its loader). Minecraft's online list merges console join lines with ping, query and RCON.
- Vintage Story: a mod installer (its mod database, dependencies from `modinfo.json`), a version changer and a Players
  tab (online players with join times, roles, bans, whitelist; kick, ban, unban, whitelist and role as console
  commands).
- Servers that ignore their stop: the panel notices repeated forced stops and offers a one-click change of the egg's
  stop to SIGINT or SIGTERM; Pterodactyl's `^C^C` stop is imported as SIGINT.
- The image policy described under the rules above: only octail-yolks images by default, foreign images in egg and
  Pterodactyl imports mapped to their replacement (the map is generated from octail-yolks' `images.json`).

### 2026-10-16 to 2026-10-17: fixes for six eggs that failed real runs (round 28)

- **Team Fortress 2 Classified**: disk hint 40 GB (TF2 plus TF2 Classified, each with the download SteamCMD stages
  first; 30 GB ran out) and a free-space check before SteamCMD.
- **Black Mesa**: disk hint 50 GB (31 GB of files plus a 13.5 GB staged download) with the same early check.
- **Zombie Panic! Source**: the Linux server segfaulted after loading its VPKs without Valve's Steam Runtime, as its
  developers warn; the install adds the pinned Steam Runtime (scout, SHA-256 checked) and starts through it.
- **Risk of Rain 2**: Steam's public branch of the dedicated server (app 1180760) has carried an empty depot since
  2025-11, so SteamCMD "installs" nothing. The egg now says so when it happens; it's recorded as `blocked` upstream.
- **Unreal Tournament (1999)**: the CD image unpacks with Joliet names (`System/BotPack.u`); files are now found
  case-insensitively.
- **Unreal Tournament 2004**: waits for the ready lines UT2004 really prints ("Game engine initialized" is UT99's).
- Real runs afterwards: UT99, UT2004 and Zombie Panic! Source pass. TF2 Classified and Black Mesa still need a node with
  at least 50 GB free to be tested.

### 2026-10-13: eleven new eggs and egg fixes (round 27)

- **New eggs**: Quake Live (anonymous SteamCMD); Unreal Tournament 99 and 2004 from OldUnreal's disc images and patches
  (SHA-256 pinned; Epic's terms asked through `eula_variable`); Leaf (SHA-256 from its API, also in the version changer)
  and Pufferfish (no published checksums: two builds pinned, others need a staff-set SHA-256); Risk of Rain 2 (Wine,
  Thunderstore-ready), Ground Branch (Wine) and Wurm Unlimited; Hytale (the official bootstrap jar from Hytale's Maven,
  SHA-1 checked; the owner signs in with `/auth login device` and the server downloads its own files); Team Fortress 2
  Classified (two SteamCMD apps, 64-bit) and Zombie Panic! Source.
- **Skipped on purpose**: Medieval Engineers (its public branch has been frozen since 2020) and Open Fortress (no
  dedicated server on Steam yet).
- **Fixes**: Forge picks its start by what the installer left (Minecraft 26.x leaves neither `server.jar` nor
  `unix_args.txt` where the old start looked); Space Station 14 stops with SIGTERM (its `shutdown` command crashed and
  Ctrl+C printed help); ARK: Survival Evolved's RCON port is assigned per server (game port + 3) instead of a fixed 27020
  that clashed between servers on one node; Valheim with BepInEx reserves its query port and reads players over A2S
  like plain Valheim; Black Mesa's disk hint went to 40 GB; 15 eggs lost defaults naming another panel ("A Pterodactyl
  Hosted Server" and friends); Hurtworld's Auto Update setting got its proper name; PowerNukkitX's start crash
  documented (an upstream bug in every release 2.0.0 to 3.0.5, fixed only on its beta branch).
- **Real runs**: Forge and Space Station 14 pass after the fixes; Ground Branch, Wurm Unlimited, Quake Live and Leaf
  pass. TF2 Classified (SteamCMD needed more free disk to update itself), Risk of Rain 2 and Zombie Panic! Source failed
  and went to the round 28 fixes above.

### 2026-10-13: sixteen new eggs, rules that match the runtime (round 26)

- **New eggs**: Left 4 Dead, Half-Life 2: Deathmatch and Black Mesa (Source, anonymous SteamCMD; Synergy left out, it
  needs an account that owns Half-Life 2); Urban Terror, OpenArena and Red Eclipse 2 (official releases, SHA-256
  pinned, admin passwords write-only); PocketMine-MP (pmmp's own PHP build, checked) and PowerNukkitX (checked release
  jar, licence through `eula_variable`), both with a Players tab over the Minecraft query; Rising World (Linux), PixARK
  and Myth of Empires (Wine); Killing Floor (needs a Steam account), Natural Selection 2 and Squad 44; Mohist and
  Arclight, hybrid Minecraft servers with both mods and plugins (SHA-256 checked). Last Oasis was left out (it needs
  keys).
- **Spigot** builds in the new `installer_java_25` image (no Temurin download for Java 25 versions).
- **Rules match the runtime**: `rcon` without a type means Minecraft; unknown `sleep`, `steam_login` or `rcon` values
  are off rather than guessed; `eula_variable` can't name a port, the managed RCON password or the Steam login.
- **Six more Steam tokens write-only** (ASKA, The Forest, Day of Infamy, Fistful of Frags, Insurgency, No More Room in
  Hell), with a test that keeps every token-like variable secret.
- **Fixes from real runs**: Fabric and NeoForge default to Java 25 (Fabric crashed on its old Java 8 default; a test
  now checks every Minecraft Java egg); TShock, Space Station 14 and OpenRCT2 stage their downloads on the server disk
  and never let `unzip` prompt (a full 100 MB install `/tmp` made `unzip` wait forever).
- **Real runs**: three batches. Batch 1: Counter-Strike 1.6, Half-Life Deathmatch, Team Fortress Classic, Day of
  Defeat, Deathmatch Classic, Condition Zero, Sven Co-op, Mindustry, Luanti, DDNet, Xonotic, Core Keeper, Barotrauma,
  Vintage Story, BungeeCord and Mumble pass. Batch 2: TShock, Factorio, tModLoader, HL2: Deathmatch, Urban Terror,
  OpenArena, Red Eclipse, PocketMine-MP, Rising World, Natural Selection 2, Quilt, Purpur, Mohist and Arclight pass;
  PowerNukkitX fails upstream. Batch 3: Fabric and NeoForge pass on Java 25, Left 4 Dead passes.

### 2026-10-12: forty-five new eggs in two rounds, the EULA setting (rounds 24 and 25)

- **Voice**: TeamSpeak 3 (SHA-256 from teamspeak.com's version list; the licence is the operator's to accept) and
  Mumble (Debian's signed `mumble-server` package unpacked into the server folder; Mumble ships no Linux server build).
  New `voice/` folder.
- **Apps**: Node.js, Python, Java JAR and Go eggs for Discord bots and small services (code from a git repository over
  HTTPS, or uploaded; dependencies installed at start). New `apps/` folder.
- **Minecraft**: Purpur (MD5), Folia (SHA-256), BungeeCord (no checksum published; Waterfall is end of life),
  SpongeVanilla (SHA-1), Quilt (installer SHA-256, Mojang jar SHA-1), Spigot (BuildTools pinned by SHA-256) and Geyser
  Standalone (SHA-256).
- **GoldSrc**: Counter-Strike 1.6, Half-Life Deathmatch and Sven Co-op, then Condition Zero, Team Fortress Classic, Day
  of Defeat and Deathmatch Classic on the same install script (a test keeps them in step). New `goldsrc/` folder.
- **Source**: No More Room in Hell, Day of Infamy, Insurgency (2014) and Fistful of Frags.
- **Wine**: Empyrion (its own config copy, telnet off), Stormworks (config written at install) and Night of the Dead;
  The Forest, Return to Moria and ASKA. Sunkenland was skipped: its server only loads a world made in the game client.
- **Steam**: American Truck Simulator, Assetto Corsa (the first egg using `steam_login`), The Isle (Evrima), Holdfast:
  Nations At War, SCP: Secret Laboratory (EULA through `eula_variable`), Arma 3, DayZ and Starbound (Steam account).
- **Standalone**: BeamMP (needs an AuthKey), Luanti (Alpine's signed package, game pinned by SHA-256), Xonotic
  (SHA-512 checked), DDNet (SHA-256 checked), Space Station 14 (manifest SHA-256), Terraria TShock (on the new
  `dotnet_9` image) and OpenRCT2 (needs the original RollerCoaster Tycoon 2 data files).
- **Write-only variables**: tokens in 17 shipped eggs marked secret (GIT_TOKEN, GSLTs, Steam tokens, BeamMP, Pavlov,
  Don't Starve Together and Factorio keys).
- **One rule set** for the panel's importer and the standalone validator (see the format above); the validator stopped
  refusing valid `fixed_ports` objects, `rcon: true` and `rcon_status`.
- **EULA auto-accept**: the panel setting `server_tools.auto_accept_eula`, off by default. Bedrock, BungeeCord and
  Velocity have no EULA prompt, so they count as `untested` rather than `blocked`.
- **Fixes**: Velocity defaults to Java 25 (current Velocity can't run on Java 8); Space Station 14 downloads time out and
  retry instead of hanging. Paper and Velocity pass real runs.
- 102 eggs at the end of the day.

### 2026-10-12: a record of real runs (round 22)

- `tested.json`: one entry per egg with the result, date, image, ready time and memory peak of its last real run, shown
  in [TESTED.md](TESTED.md), the README tables, the panel's Admin, Eggs page and the docs. Runs on the old upstream images
  are kept as `previous`. `npm run eggs:record-smoke` copies a smoke-run report into it.
- Port readiness (`x_octail.features.ready`): Craftopia and Astroneer also count as started once their UDP game port is
  bound, after probes showed both run and listen but never print a line the panel could wait for.
- The panel's import preview lists what differs from the panel's copy of an egg.
- Stationeers passes on octail-yolks with `-logFile -` (its ready line didn't reach the console without it).

### 2026-10-10: first real runs on our own images (rounds 20 and 21)

- 14 eggs pass on octail-yolks images: V Rising (BepInEx), Rust, 7 Days to Die, Icarus, Sons of the Forest, Space
  Engineers, ARK: Survival Ascended (Proton; it needs at least 12 GB), Enshrouded, Abiotic Factor, Squad, OpenTTD,
  Valheim, Terraria and Counter-Strike: Source.
- ARK: Survival Ascended removes the Windows Steam DLLs that make it hang under Proton; Astroneer fills an empty public
  IP (from the allocation or api.ipify.org) and detects its start from the engine's lines; Craftopia starts with
  `-batchmode -showlogs`.
- This repository's README got a category index, per-category tables linking each image to its octail-yolks row, a
  README in every folder, CONTRIBUTING and issue and pull request templates.
- Every egg re-imported on the panel (57 of 57, none on an upstream image).

### 2026-10-09: this repository, and every egg on our own images (rounds 15 to 19)

- **octail-eggs is born**: the generator (`scripts/eggs/build-repo.mjs` in the panel) writes 57 eggs into 10 category
  folders, a README index, NOTICE with pelican-eggs' MIT lines, a CHANGELOG and the standalone validator with its
  workflow. The validator's first catch: Avorion's `integereger` rule typo.
- **Every shipped egg switched to `ghcr.io/sneakywrld/octail-yolks`.** Fitting them took image changes, not startup
  changes: Xvfb and the Steam SDK on by default in the Wine images, `WINEDLLOVERRIDES` exported (V Rising BepInEx),
  Proton keeping an existing prefix, the Rust Plugins folder on `LD_LIBRARY_PATH`, `nc` and `telnet` for 7 Days to Die,
  Pavlov's `libc++`. Squad got `AUTO_UPDATE` (our images only update when asked), NeoForge installs on
  `installer_java_21`, and Rust's `ADDITIONAL_ARGS` quotes now reach the server as written.
- **New eggs**: Valheim (plain), Necesse, Conan Exiles, Space Engineers, Sons of the Forest, Abiotic Factor, Soulmask,
  Icarus, The Front, Pavlov VR, Counter-Strike: Source and Day of Defeat: Source; then Stationeers, Hurtworld,
  Mindustry (SHA-256 checked), OpenTTD (checked against its manifest), Astroneer and Craftopia.
- **Players tab for every game** with a player list: A2S, Source `status`, Rust `playerlist`; kick, ban and message over
  RCON.
- **Fixes from the first real runs**: Valheim (plain and BepInEx) crashed in PlayFab's logger for any non-root user; it
  was the upstream image's `nss_wrapper`, which our images never use (the node mounts an `/etc/passwd` instead).
  Valheim exports its library path and app id; Sons of the Forest writes `steam_appid.txt`; Space Engineers' config had
  an empty line before `<?xml ?>` and ran on defaults; Eco starts with `-offline` without an SLG account; Killing Floor 2
  needs 40 GB; Project Zomboid caps its Java heap at 80 % of the server's memory (Build 42's 8 GB default was
  OOM-killed); Barotrauma got a working console (the node answers .NET's cursor queries); Stationeers waits for its
  RakNet line.
- `fixed_ports` for ports a game opens at a fixed offset (Pavlov VR's +400).

### 2026-10-08: the popular games (rounds 9 to 14)

- **13 popular game eggs**: Terraria (vanilla and tModLoader), Factorio, Palworld, Project Zomboid, Enshrouded, CS2,
  ARK (Evolved and Ascended), 7 Days to Die, V Rising (BepInEx), Don't Starve Together (upstream's config downloads
  fixed, its Caves shard given a real port) and Unturned.
- **More eggs**: Vintage Story (rewritten install over HTTPS with an MD5 check; name and password with
  `--withconfig`); Arma Reforger, Barotrauma, Core Keeper, Squad, Insurgency: Sandstorm and Mordhau; Team Fortress 2,
  Left 4 Dead 2, Killing Floor 2, Euro Truck Simulator 2, Avorion and Eco; Valheim with BepInEx for the Thunderstore
  mod browser.
- **SteamCMD retries**: every SteamCMD egg retries its download up to three times, after the first real runs
  (Barotrauma, Core Keeper) failed with "Missing configuration".
- Core Keeper's stop reaches the server so it saves; player counts over A2S or RCON `status` (`player_query`); eggs
  diffed against pelican-eggs upstream (Garry's Mod's `sbox_maxvehicles` back to 20, Valheim BepInEx's broken update
  URL fixed).
- First real runs of shipped eggs on our test nodes: Terraria, Factorio, Vintage Story, Barotrauma; on 2026-10-09 all
  11 bigger SteamCMD eggs (TF2, Left 4 Dead 2, Core Keeper, Avorion, ETS2, Killing Floor 2, Eco, Insurgency: Sandstorm,
  Mordhau, Arma Reforger, Squad) installed, started, took a command and stopped.

### 2026-10-07: the first game eggs

- Rust (WebRCON), Satisfactory (its HTTPS API as the console), the generic Source (SRCDS) and generic SteamCMD eggs,
  Fabric, Forge, NeoForge and the Velocity proxy, Minecraft Bedrock, and Garry's Mod with the Steam Workshop tool.
- Rust's wipe manager, generic UDP idle sleep for Rust, Satisfactory and Source games.

### 2026-10-06: the importer and the first eggs

- The panel's egg importer (Pterodactyl and Pelican formats, from text, files, folders, zips, URLs, GitHub and live
  panels) and exporter.
- Octail's test game (a tiny shell "game" used in CI) and Minecraft Paper, the first two shipped eggs. The first real
  Podman and Docker runs (the test game, Paper and Bedrock) reached running.

## Every shipped egg

One table per folder. "First added" is the date the egg's file first appeared in the panel repository; "Smoke" is its
`tested.json` result (with the run's date). Runtime images are octail-yolks tags (see
[octail-yolks](https://github.com/sneakywrld/octail-yolks#tags)).

### Minecraft (`minecraft/`, 23)

| Egg               | File                          | First added | Runtime image                                        | Install image       | Smoke             |
| ----------------- | ----------------------------- | ----------- | ---------------------------------------------------- | ------------------- | ----------------- |
| Arclight          | `minecraft/arclight.json`     | 2026-10-13  | `java_21`, `java_17`, `java_11`, `java_8`            | `installer_alpine`  | pass (2026-10-13) |
| Vanilla Bedrock   | `minecraft/bedrock.json`      | 2026-10-07  | `debian`                                             | `installer_debian`  | pass (2026-10-23) |
| BungeeCord        | `minecraft/bungeecord.json`   | 2026-10-12  | `java_25`, `java_21`, `java_17`                      | `installer_alpine`  | pass (2026-10-12) |
| Cuberite          | `minecraft/cuberite.json`     | 2026-10-23  | `debian`                                             | `installer_alpine`  | pass (2026-10-23) |
| Fabric            | `minecraft/fabric.json`       | 2026-10-07  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_java_11` | pass (2026-10-13) |
| Folia             | `minecraft/folia.json`        | 2026-10-12  | `java_25`, `java_21`, `java_17`                      | `installer_alpine`  | pass (2026-10-24) |
| Forge             | `minecraft/forge.json`        | 2026-10-07  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_java_8`  | pass (2026-10-23) |
| Gate              | `minecraft/gate.json`         | 2026-10-23  | `debian`                                             | `installer_alpine`  | pass (2026-10-24) |
| Geyser Standalone | `minecraft/geyser.json`       | 2026-10-12  | `java_25`, `java_21`                                 | `installer_alpine`  | pass (2026-10-24) |
| Leaf              | `minecraft/leaf.json`         | 2026-10-13  | `java_25`, `java_21`                                 | `installer_alpine`  | pass (2026-10-13) |
| Mohist            | `minecraft/mohist.json`       | 2026-10-13  | `java_21`, `java_17`, `java_11`, `java_8`            | `installer_alpine`  | pass (2026-10-13) |
| NanoLimbo         | `minecraft/nanolimbo.json`    | 2026-10-23  | `java_25`, `java_21`                                 | `installer_alpine`  | pass (2026-10-23) |
| NeoForge          | `minecraft/neoforge.json`     | 2026-10-07  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_java_21` | pass (2026-10-23) |
| Paper             | `minecraft/paper.json`        | 2026-10-06  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_alpine`  | pass (2026-10-12) |
| PocketMine-MP     | `minecraft/pocketmine.json`   | 2026-10-13  | `debian`                                             | `installer_alpine`  | pass (2026-10-13) |
| PowerNukkitX      | `minecraft/powernukkitx.json` | 2026-10-13  | `java_21`, `java_25`                                 | `installer_alpine`  | pass (2026-10-24) |
| Pufferfish        | `minecraft/pufferfish.json`   | 2026-10-13  | `java_25`, `java_21`, `java_17`                      | `installer_alpine`  | pass (2026-10-24) |
| Purpur            | `minecraft/purpur.json`       | 2026-10-12  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_alpine`  | pass (2026-10-13) |
| Quilt             | `minecraft/quilt.json`        | 2026-10-12  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_java_21` | pass (2026-10-13) |
| Spigot            | `minecraft/spigot.json`       | 2026-10-12  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_java_25` | pass (2026-10-24) |
| SpongeVanilla     | `minecraft/sponge.json`       | 2026-10-12  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_alpine`  | pass (2026-10-24) |
| Vanilla Minecraft | `minecraft/vanilla.json`      | 2026-10-23  | `java_25`, `java_21`, `java_17`, `java_11`, `java_8` | `installer_alpine`  | pass (2026-10-24) |
| Velocity          | `minecraft/velocity.json`     | 2026-10-07  | `java_25`, `java_21`, `java_17`                      | `installer_alpine`  | pass (2026-10-23) |

### Source (`source/`, 16)

| Egg                        | File                                     | First added | Runtime image     | Install image      | Smoke             |
| -------------------------- | ---------------------------------------- | ----------- | ----------------- | ------------------ | ----------------- |
| Black Mesa: Deathmatch     | `source/black-mesa.json`                 | 2026-10-13  | `source`          | `installer_debian` | pass (2026-10-24) |
| Counter-Strike 2           | `source/counter-strike-2.json`           | 2026-10-08  | `steamcmd_sniper` | `installer_debian` | pass (2026-10-25) |
| Counter-Strike: Source     | `source/counter-strike-source.json`      | 2026-10-09  | `steamcmd_debian` | `installer_debian` | pass (2026-10-23) |
| Day of Defeat: Source      | `source/day-of-defeat-source.json`       | 2026-10-09  | `source`          | `installer_debian` | pass (2026-10-23) |
| Day of Infamy              | `source/day-of-infamy.json`              | 2026-10-12  | `source`          | `installer_debian` | pass (2026-10-24) |
| Fistful of Frags           | `source/fistful-of-frags.json`           | 2026-10-12  | `source`          | `installer_debian` | pass (2026-10-23) |
| Garry's Mod                | `source/garrysmod.json`                  | 2026-10-07  | `source`          | `installer_debian` | pass (2026-10-23) |
| Half-Life 2: Deathmatch    | `source/half-life-2-deathmatch.json`     | 2026-10-13  | `source`          | `installer_debian` | pass (2026-10-13) |
| Insurgency (2014)          | `source/insurgency.json`                 | 2026-10-12  | `source`          | `installer_debian` | pass (2026-10-24) |
| Left 4 Dead 2              | `source/left-4-dead-2.json`              | 2026-10-08  | `source`          | `installer_debian` | pass (2026-10-24) |
| Left 4 Dead                | `source/left-4-dead.json`                | 2026-10-13  | `source`          | `installer_debian` | pass (2026-10-13) |
| No More Room in Hell       | `source/no-more-room-in-hell.json`       | 2026-10-12  | `source`          | `installer_debian` | pass (2026-10-24) |
| Source Engine Game (SRCDS) | `source/generic.json`                    | 2026-10-07  | `source`          | `installer_debian` | pass (2026-10-24) |
| Team Fortress 2 Classified | `source/team-fortress-2-classified.json` | 2026-10-13  | `source`          | `installer_debian` | pass (2026-10-24) |
| Team Fortress 2            | `source/team-fortress-2.json`            | 2026-10-08  | `source`          | `installer_debian` | pass (2026-10-24) |
| Zombie Panic! Source       | `source/zombie-panic-source.json`        | 2026-10-13  | `source`          | `installer_debian` | pass (2026-10-16) |

### GoldSrc (`goldsrc/`, 7)

| Egg                            | File                                         | First added | Runtime image | Install image      | Smoke             |
| ------------------------------ | -------------------------------------------- | ----------- | ------------- | ------------------ | ----------------- |
| Counter-Strike 1.6             | `goldsrc/counter-strike-16.json`             | 2026-10-12  | `source`      | `installer_debian` | pass (2026-10-12) |
| Counter-Strike: Condition Zero | `goldsrc/counter-strike-condition-zero.json` | 2026-10-12  | `source`      | `installer_debian` | pass (2026-10-12) |
| Day of Defeat                  | `goldsrc/day-of-defeat.json`                 | 2026-10-12  | `source`      | `installer_debian` | pass (2026-10-12) |
| Deathmatch Classic             | `goldsrc/deathmatch-classic.json`            | 2026-10-12  | `source`      | `installer_debian` | pass (2026-10-12) |
| Half-Life Deathmatch           | `goldsrc/half-life-deathmatch.json`          | 2026-10-12  | `source`      | `installer_debian` | pass (2026-10-12) |
| Sven Co-op                     | `goldsrc/sven-co-op.json`                    | 2026-10-12  | `source`      | `installer_debian` | pass (2026-10-12) |
| Team Fortress Classic          | `goldsrc/team-fortress-classic.json`         | 2026-10-12  | `source`      | `installer_debian` | pass (2026-10-12) |

### Rust (`rust/`, 1)

| Egg  | File             | First added | Runtime image | Install image      | Smoke             |
| ---- | ---------------- | ----------- | ------------- | ------------------ | ----------------- |
| Rust | `rust/rust.json` | 2026-10-07  | `rust`        | `installer_debian` | pass (2026-10-24) |

### ARK (`ark/`, 2)

| Egg                    | File                         | First added | Runtime image     | Install image      | Smoke             |
| ---------------------- | ---------------------------- | ----------- | ----------------- | ------------------ | ----------------- |
| ARK: Survival Ascended | `ark/survival-ascended.json` | 2026-10-08  | `proton`          | `installer_debian` | pass (2026-10-10) |
| Ark: Survival Evolved  | `ark/survival-evolved.json`  | 2026-10-08  | `steamcmd_debian` | `installer_debian` | pass (2026-10-24) |

### Valheim (`valheim/`, 2)

| Egg             | File                   | First added | Runtime image     | Install image      | Smoke             |
| --------------- | ---------------------- | ----------- | ----------------- | ------------------ | ----------------- |
| Valheim BepINex | `valheim/bepinex.json` | 2026-10-08  | `steamcmd_debian` | `installer_debian` | pass (2026-10-24) |
| Valheim         | `valheim/valheim.json` | 2026-10-09  | `steamcmd_debian` | `installer_debian` | pass (2026-10-10) |

### Terraria (`terraria/`, 3)

| Egg              | File                       | First added | Runtime image           | Install image      | Smoke             |
| ---------------- | -------------------------- | ----------- | ----------------------- | ------------------ | ----------------- |
| tModloader       | `terraria/tmodloader.json` | 2026-10-08  | `dotnet_8`              | `installer_debian` | pass (2026-10-24) |
| Terraria TShock  | `terraria/tshock.json`     | 2026-10-12  | `dotnet_9`, `dotnet_10` | `installer_debian` | pass (2026-10-13) |
| Terraria Vanilla | `terraria/vanilla.json`    | 2026-10-08  | `debian`                | `installer_debian` | pass (2026-10-23) |

### Steam games (`steam/`, 65)

| Egg                                       | File                                   | First added | Runtime image          | Install image      | Smoke             |
| ----------------------------------------- | -------------------------------------- | ----------- | ---------------------- | ------------------ | ----------------- |
| 7 Days To Die                             | `steam/7-days-to-die.json`             | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-10) |
| Abiotic Factor                            | `steam/abiotic-factor.json`            | 2026-10-09  | `proton`               | `installer_debian` | pass (2026-10-10) |
| American Truck Simulator Dedicated Server | `steam/american-truck-simulator.json`  | 2026-10-12  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Arma 3                                    | `steam/arma-3.json`                    | 2026-10-12  | `steamcmd_debian`      | `installer_debian` | blocked           |
| Arma Reforger                             | `steam/arma-reforger.json`             | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| ASKA                                      | `steam/aska.json`                      | 2026-10-12  | `wine`                 | `installer_debian` | blocked           |
| Assetto Corsa                             | `steam/assetto-corsa.json`             | 2026-10-12  | `steamcmd_debian`      | `installer_debian` | blocked           |
| Astroneer                                 | `steam/astroneer.json`                 | 2026-10-09  | `proton`               | `installer_debian` | pass (2026-10-24) |
| Avorion                                   | `steam/avorion.json`                   | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-23) |
| Ballistic Overkill                        | `steam/ballistic-overkill.json`        | 2026-10-23  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Barotrauma                                | `steam/barotrauma.json`                | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-12) |
| Chivalry: Medieval Warfare                | `steam/chivalry-medieval-warfare.json` | 2026-10-23  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-23) |
| Conan Exiles Enhanced                     | `steam/conan-exiles.json`              | 2026-10-09  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Core Keeper                               | `steam/core-keeper.json`               | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-12) |
| Craftopia                                 | `steam/craftopia.json`                 | 2026-10-09  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| DayZ                                      | `steam/dayz.json`                      | 2026-10-12  | `steamcmd_debian`      | `installer_debian` | blocked           |
| Don't Starve Together                     | `steam/dont-starve-together.json`      | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | blocked           |
| Eco                                       | `steam/eco.json`                       | 2026-10-08  | `steamcmd_dotnet`      | `installer_debian` | pass (2026-10-24) |
| Empyrion - Galactic Survival              | `steam/empyrion.json`                  | 2026-10-12  | `wine`, `wine_staging` | `installer_debian` | pass (2026-10-24) |
| Enshrouded                                | `steam/enshrouded.json`                | 2026-10-08  | `proton`               | `installer_debian` | pass (2026-10-10) |
| Euro Truck Simulator 2 Dedicated Server   | `steam/euro-truck-simulator-2.json`    | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| FOUNDRY                                   | `steam/foundry.json`                   | 2026-10-23  | `wine`                 | `installer_debian` | pass (2026-10-24) |
| Ground Branch                             | `steam/ground-branch.json`             | 2026-10-13  | `wine_staging`, `wine` | `installer_debian` | pass (2026-10-13) |
| Holdfast: Nations At War                  | `steam/holdfast.json`                  | 2026-10-12  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Hurtworld                                 | `steam/hurtworld.json`                 | 2026-10-09  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Icarus                                    | `steam/icarus.json`                    | 2026-10-09  | `wine`                 | `installer_debian` | pass (2026-10-10) |
| Insurgency: Sandstorm                     | `steam/insurgency-sandstorm.json`      | 2026-10-08  | `steamcmd_ubuntu`      | `installer_debian` | pass (2026-10-24) |
| Killing Floor 2                           | `steam/killing-floor-2.json`           | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Killing Floor                             | `steam/killing-floor.json`             | 2026-10-13  | `steamcmd_debian`      | `installer_debian` | blocked           |
| Mordhau                                   | `steam/mordhau.json`                   | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Myth of Empires                           | `steam/myth-of-empires.json`           | 2026-10-13  | `wine`                 | `installer_debian` | pass (2026-10-24) |
| Natural Selection 2                       | `steam/natural-selection-2.json`       | 2026-10-13  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-13) |
| Necesse                                   | `steam/necesse.json`                   | 2026-10-09  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-23) |
| Night of the Dead                         | `steam/night-of-the-dead.json`         | 2026-10-12  | `wine`                 | `installer_debian` | pass (2026-10-24) |
| Nightingale                               | `steam/nightingale.json`               | 2026-10-23  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Operation: Harsh Doorstop                 | `steam/operation-harsh-doorstop.json`  | 2026-10-23  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Palworld                                  | `steam/palworld.json`                  | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-25) |
| Pavlov VR                                 | `steam/pavlov-vr.json`                 | 2026-10-09  | `steamcmd_ubuntu`      | `installer_debian` | blocked           |
| PixARK                                    | `steam/pixark.json`                    | 2026-10-13  | `wine`                 | `installer_debian` | pass (2026-10-24) |
| Project Zomboid                           | `steam/project-zomboid.json`           | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Quake Live                                | `steam/quake-live.json`                | 2026-10-13  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-13) |
| The Lord of the Rings: Return to Moria    | `steam/return-to-moria.json`           | 2026-10-12  | `wine`                 | `installer_debian` | pass (2026-10-24) |
| Rising World                              | `steam/rising-world.json`              | 2026-10-13  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-13) |
| Risk of Rain 2                            | `steam/risk-of-rain-2.json`            | 2026-10-13  | `wine`                 | `installer_debian` | blocked           |
| RuneScape: Dragonwilds                    | `steam/runescape-dragonwilds.json`     | 2026-10-23  | `steamcmd_debian`      | `installer_debian` | blocked           |
| Satisfactory                              | `steam/satisfactory.json`              | 2026-10-07  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-25) |
| SCP: Secret Laboratory                    | `steam/scp-secret-laboratory.json`     | 2026-10-12  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Smalland: Survive the Wilds               | `steam/smalland.json`                  | 2026-10-23  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Sons Of The Forest                        | `steam/sons-of-the-forest.json`        | 2026-10-09  | `wine`                 | `installer_debian` | pass (2026-10-10) |
| Soulmask                                  | `steam/soulmask.json`                  | 2026-10-09  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Space Engineers                           | `steam/space-engineers.json`           | 2026-10-09  | `wine`                 | `installer_debian` | pass (2026-10-10) |
| Squad 44                                  | `steam/squad-44.json`                  | 2026-10-13  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Squad                                     | `steam/squad.json`                     | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-10) |
| Starbound                                 | `steam/starbound.json`                 | 2026-10-12  | `steamcmd_debian`      | `installer_debian` | blocked           |
| Stationeers                               | `steam/stationeers.json`               | 2026-10-09  | `steamcmd_ubuntu`      | `installer_debian` | pass (2026-10-12) |
| Stormworks: Build and Rescue              | `steam/stormworks.json`                | 2026-10-12  | `wine`, `wine_staging` | `installer_debian` | blocked           |
| The Forest                                | `steam/the-forest.json`                | 2026-10-12  | `wine`                 | `installer_debian` | pass (2026-10-24) |
| The Front                                 | `steam/the-front.json`                 | 2026-10-09  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| The Isle (Evrima)                         | `steam/the-isle.json`                  | 2026-10-12  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Unturned                                  | `steam/unturned.json`                  | 2026-10-08  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-23) |
| V Rising BepInEx                          | `steam/v-rising.json`                  | 2026-10-08  | `wine_staging`         | `installer_debian` | pass (2026-10-10) |
| VEIN                                      | `steam/vein.json`                      | 2026-10-23  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-24) |
| Warfork                                   | `steam/warfork.json`                   | 2026-10-23  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-23) |
| Windrose                                  | `steam/windrose.json`                  | 2026-10-23  | `proton`               | `installer_debian` | pass (2026-10-24) |
| Wurm Unlimited                            | `steam/wurm-unlimited.json`            | 2026-10-13  | `steamcmd_debian`      | `installer_debian` | pass (2026-10-13) |

### SteamCMD (`steamcmd/`, 1)

| Egg                   | File                    | First added | Runtime image               | Install image      | Smoke             |
| --------------------- | ----------------------- | ----------- | --------------------------- | ------------------ | ----------------- |
| Generic SteamCMD game | `steamcmd/generic.json` | 2026-10-07  | `steamcmd_debian`, `proton` | `installer_debian` | pass (2026-10-24) |

### Standalone games (`standalone/`, 23)

| Egg                            | File                                     | First added | Runtime image           | Install image      | Smoke             |
| ------------------------------ | ---------------------------------------- | ----------- | ----------------------- | ------------------ | ----------------- |
| AssaultCube                    | `standalone/assaultcube.json`            | 2026-10-23  | `debian`                | `installer_debian` | pass (2026-10-23) |
| BeamMP Server                  | `standalone/beammp.json`                 | 2026-10-12  | `debian`                | `installer_debian` | blocked           |
| DDraceNetwork (DDNet)          | `standalone/ddnet.json`                  | 2026-10-12  | `debian`                | `installer_debian` | pass (2026-10-12) |
| ET: Legacy                     | `standalone/et-legacy.json`              | 2026-10-23  | `debian`                | `installer_debian` | pass (2026-10-23) |
| Factorio                       | `standalone/factorio.json`               | 2026-10-08  | `debian`                | `installer_debian` | pass (2026-10-24) |
| Hytale                         | `standalone/hytale.json`                 | 2026-10-13  | `java_25`               | `installer_alpine` | blocked           |
| Luanti                         | `standalone/luanti.json`                 | 2026-10-12  | `alpine`                | `installer_alpine` | pass (2026-10-12) |
| Mindustry                      | `standalone/mindustry.json`              | 2026-10-09  | `java_21`, `java_17`    | `installer_debian` | pass (2026-10-12) |
| OpenArena                      | `standalone/openarena.json`              | 2026-10-13  | `debian`                | `installer_debian` | pass (2026-10-13) |
| OpenRA                         | `standalone/openra.json`                 | 2026-10-23  | `debian`                | `installer_debian` | pass (2026-10-23) |
| OpenRCT2                       | `standalone/openrct2.json`               | 2026-10-12  | `debian`                | `installer_debian` | blocked           |
| OpenTTD                        | `standalone/openttd.json`                | 2026-10-09  | `debian`                | `installer_alpine` | pass (2026-10-10) |
| Red Eclipse 2                  | `standalone/red-eclipse.json`            | 2026-10-13  | `debian`                | `installer_debian` | pass (2026-10-13) |
| Space Station 14               | `standalone/space-station-14.json`       | 2026-10-12  | `dotnet_10`             | `installer_debian` | pass (2026-10-13) |
| SuperTuxKart                   | `standalone/supertuxkart.json`           | 2026-10-23  | `debian`                | `installer_debian` | pass (2026-10-24) |
| Teeworlds                      | `standalone/teeworlds.json`              | 2026-10-23  | `debian`                | `installer_debian` | pass (2026-10-23) |
| TES3MP (Morrowind multiplayer) | `standalone/tes3mp.json`                 | 2026-10-23  | `debian`                | `installer_debian` | pass (2026-10-23) |
| Unreal Tournament 2004         | `standalone/unreal-tournament-2004.json` | 2026-10-13  | `debian`                | `installer_debian` | pass (2026-10-16) |
| Unreal Tournament (1999)       | `standalone/unreal-tournament-99.json`   | 2026-10-13  | `debian`                | `installer_debian` | pass (2026-10-16) |
| Unvanquished                   | `standalone/unvanquished.json`           | 2026-10-23  | `debian`                | `installer_debian` | pass (2026-10-24) |
| Urban Terror                   | `standalone/urban-terror.json`           | 2026-10-13  | `debian`                | `installer_debian` | pass (2026-10-13) |
| Vintage Story                  | `standalone/vintage-story.json`          | 2026-10-08  | `dotnet_10`, `dotnet_8` | `installer_debian` | pass (2026-10-12) |
| Xonotic                        | `standalone/xonotic.json`                | 2026-10-12  | `debian`                | `installer_debian` | pass (2026-10-12) |

### Voice servers (`voice/`, 2)

| Egg                | File                   | First added | Runtime image | Install image      | Smoke             |
| ------------------ | ---------------------- | ----------- | ------------- | ------------------ | ----------------- |
| Mumble Server      | `voice/mumble.json`    | 2026-10-12  | `debian`      | `installer_debian` | pass (2026-10-12) |
| TeamSpeak 3 Server | `voice/teamspeak.json` | 2026-10-12  | `debian`      | `installer_debian` | pass (2026-10-24) |

### Apps (`apps/`, 12)

| Egg                       | File                       | First added | Runtime image                                        | Install image      | Smoke             |
| ------------------------- | -------------------------- | ----------- | ---------------------------------------------------- | ------------------ | ----------------- |
| Bun App                   | `apps/bun-app.json`        | 2026-10-23  | `bun_1`                                              | `installer_debian` | pass (2026-10-24) |
| Deno App                  | `apps/deno-app.json`       | 2026-10-23  | `deno_2`                                             | `installer_debian` | pass (2026-10-24) |
| Go App                    | `apps/go-app.json`         | 2026-10-12  | `go_1.27`, `go_1.26`                                 | `installer_debian` | pass (2026-10-24) |
| Java App (JAR)            | `apps/java-jar.json`       | 2026-10-12  | `java_21`, `java_25`, `java_17`, `java_11`, `java_8` | `installer_debian` | pass (2026-10-24) |
| Lavalink                  | `apps/lavalink.json`       | 2026-10-23  | `java_21`, `java_25`, `java_17`                      | `installer_debian` | pass (2026-10-23) |
| MariaDB                   | `apps/mariadb.json`        | 2026-10-23  | `debian`                                             | `installer_debian` | pass (2026-10-23) |
| Node.js App               | `apps/nodejs-app.json`     | 2026-10-12  | `nodejs_24`, `nodejs_22`, `nodejs_20`                | `installer_debian` | pass (2026-10-24) |
| PostgreSQL                | `apps/postgresql.json`     | 2026-10-23  | `debian`                                             | `installer_debian` | pass (2026-10-23) |
| Python App                | `apps/python-app.json`     | 2026-10-12  | `python_3.14`, `python_3.13`, `python_3.12`          | `installer_debian` | pass (2026-10-24) |
| Red-DiscordBot            | `apps/red-discordbot.json` | 2026-10-23  | `debian`                                             | `installer_debian` | blocked           |
| Uptime Kuma               | `apps/uptime-kuma.json`    | 2026-10-23  | `nodejs_22`                                          | `installer_debian` | pass (2026-10-23) |
| Valkey (Redis-compatible) | `apps/valkey.json`         | 2026-10-23  | `debian`                                             | `installer_debian` | pass (2026-10-23) |

### Testing (`testing/`, 1)

| Egg              | File                     | First added | Runtime image | Install image      | Smoke             |
| ---------------- | ------------------------ | ----------- | ------------- | ------------------ | ----------------- |
| Octail Test Game | `testing/test-game.json` | 2026-10-06  | `alpine`      | `installer_alpine` | pass (2026-10-24) |
