import{a as x}from"./chunk-BFIRILP2.js";import{c as D}from"./chunk-KZMOWBXQ.js";import"./chunk-JIUAA3A2.js";import{G as i,J as g,M as k,N as T,Q as w,R as v,S as C,T as a,U as s,V as y,Z as f,_ as d,aa as c,ha as S,ja as l,ka as m,la as P,r as p,s as u}from"./chunk-RA3L2WPV.js";import"./chunk-HT2G6UXV.js";import"./chunk-HIVZEDT5.js";var A=[{title:"Delivery vs Deployment",tag:"concepts",body:`Continuous Delivery needs manual approval before going live. Continuous Deployment releases automatically after all stages pass.

From the automation view, CD means deployment. From the process-building view, CD means delivery.

Delivery is an extension of CI \u2014 it auto-deploys to staging, but a human decides when to push to production.`},{title:"Concurrency vs Parallelism",tag:"concepts",body:`Concurrency is a design \u2014 how to manage multiple tasks that might overlap. Parallelism requires multiple CPUs to actually run them at the same time.

| | Concurrency | Parallelism |
|---|---|---|
| Multitasking | Yes | Only with multiple CPUs |
| Multithreading | Yes | Possible if no GIL |
| Async | Yes | Usually not |
| One CPU | Yes | No |

JS uses a single-threaded event loop. Python asyncio runs on a single thread. Both achieve concurrency without parallelism.`},{title:"Internet vs Web",tag:"concepts",body:`Internet = the entire infrastructure. TCP/IP, physical cables, routers, switches. The whole OSI model belongs here.

Web = a service running on the Internet. HTTP, HTTPS, WebSocket. What you see in a browser.

IoT counts as Internet. Utility poles don't \u2014 but they support the infrastructure.`},{title:"TTY, Terminal, Shell, Multiplexer",tag:"cli",body:`The full stack from keypress to hardware:

User \u2192 **Terminal Emulator** \u2192 **Multiplexer** (optional) \u2192 **Shell** \u2192 Kernel \u2192 Hardware

## Terminal Emulator

iTerm2, Alacritty, Windows Terminal. A GUI window that emulates the old physical terminal. Each tab spawns an independent shell process.

## Shell

The command interpreter. zsh, bash, fish, PowerShell. Reads input, parses it, and either handles it internally (\`cd\`, \`export\`) or asks the kernel to run an external program (\`ls\`, \`git\`).

zsh config load order: \`zshenv\` \u2192 \`zprofile\` \u2192 \`zshrc\`.

## Terminal Multiplexer

tmux sits **between** the terminal emulator and the shell. One terminal window, multiple sessions, windows, and panes inside.

| | Terminal tab | tmux pane |
|---|---|---|
| Survives terminal crash | No | Yes (session persists) |
| Detach/reattach | No | \`tmux detach\` / \`tmux attach\` |
| Remote SSH session | Dies on disconnect | Keeps running |
| Split panes | Depends on terminal | Built-in |

The key insight: tmux owns the shell process. The terminal emulator only renders what tmux sends. Close iTerm, the tmux session and all its shells keep running.

## TTY

TeleTYpewriter. The kernel-level I/O abstraction. \`/dev/tty*\` are device files. When you open a terminal tab, the kernel allocates a pseudo-terminal (PTY = master + slave pair). The terminal emulator writes to master, the shell reads from slave.

\`\`\`bash
# See your current TTY
tty
# List all active shell processes
ps -f | grep -E 'bash|zsh|fish' | grep -v grep
\`\`\``},{title:"pip install vs python -m pip install",tag:"python",body:"`pip install` finds pip in your PATH \u2014 often a symlink like /usr/bin/pip. You might not know which Python version it belongs to.\n\n`python -m pip install` uses that specific Python's own pip. You always know exactly where packages land.\n\nWhen multiple Python versions coexist, always use `python -m pip install`."},{title:"<script> async vs defer vs module",tag:"web",body:`Four ways to load JS in HTML. They differ in **when the script downloads**, **when it executes**, and **how it interacts with the HTML parser**. The deeper truth: HTML parser and JS execution share the **main thread**. Whoever holds the thread blocks the other.

| Tag | Fetch blocks parser? | Exec blocks parser? | Order |
|---|---|---|---|
| \`<script>\` | Yes (sync fetch + exec) | Yes | Document order |
| \`<script async>\` | No (parallel fetch) | **Yes, briefly** at the moment fetch completes | Whoever downloads first |
| \`<script defer>\` | No | No (parser already done) | Document order |
| \`<script type="module">\` | No | No | Document order + own scope (no window pollution) |

Timeline:

\`\`\`
classic:  parse\u2500\u2500[fetch+exec STOP everything]\u2500\u2500parse\u2500\u2500
async:    parse\u2500\u2500parse\u2500\u2500[BANG exec, brief stop]\u2500\u2500parse
defer:    parse\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500[done]\u2500\u2500[exec in order]\u2500\u2500DOMContentLoaded
\`\`\`

When async finishes downloading, browser interrupts the parser to run the JS \u2014 that's the brief block. Defer never blocks because execution is queued for after parsing.

## When to pick which

- **Default \u2192 \`defer\`**. Predictable order, never blocks rendering.
- **Independent tracking / analytics / ads \u2192 \`async\`**. No order dependency, run ASAP.
- **Modern ES modules \u2192 \`<script type="module">\`**. Auto-defers + module scope (variables don't leak to \`window\`).
- **Legacy libs that pollute \`window\` (jQuery) \u2192 keep classic**. Module's scope isolation breaks them.

## What defer waits for

HTML parsing complete = DOM tree built. **Not** CSSOM, **not** Render Tree, **not** paint. Defer scripts run between "DOM done" and \`DOMContentLoaded\` event.

## DOM ready \u2260 visible

After DOM is ready, the browser still has to:

\`\`\`
DOM + CSSOM \u2192 Render Tree \u2192 Layout \u2192 Paint \u2192 Composite \u2192 screen
\`\`\`

Only Composite puts pixels on screen. The white-screen gap between DOMContentLoaded and First Contentful Paint (FCP) is the rest of the rendering pipeline running.`},{title:"Compress Git History",tag:"git",body:`Use \`git checkout --orphan\` to squash all history into a single commit.

\`\`\`bash
git checkout --orphan temp
git add -A
git commit -m "Compress all history"
git branch -D main
git branch -m main
git push -f origin main
\`\`\`

Useful when legacy commits are messy and you want a clean starting point.`},{title:"Font Categories",tag:"web",body:`| Category | Trait | Examples | Use case |
|---|---|---|---|
| Serif | Decorative strokes at the end of each letter | Times New Roman, Lora, Georgia | Long-form reading, articles, books |
| Sans-serif | Clean strokes, no decoration | Helvetica, IBM Plex Sans, Arial | Headings, UI, buttons, navigation |
| Monospace | Every character has the same width | Geist Mono, Consolas, Courier | Code, terminal, technical data |`},{title:"x86 vs x86-64 vs x64",tag:"concepts",body:`All names for two things: 32-bit and 64-bit Intel-compatible instruction sets.

| Name | Who calls it this | Bits |
|---|---|---|
| x86 | Everyone | 32 |
| AMD64 | AMD (invented it) | 64 |
| Intel 64 (EM64T) | Intel (followed AMD) | 64 |
| x64 | Microsoft | 64 |
| x86_64 | Linux | 64 |
| x86-64 | Generic | 64 |

The real difference: register width and pointer size.

| | x86 (32-bit) | x64 (64-bit) |
|---|---|---|
| Register | 32-bit (eax) | 64-bit (rax) |
| Pointer | 4 bytes | 8 bytes |
| Max RAM | 4 GB | 16 EB |

64-bit CPU can run 32-bit programs (backward compatible). 32-bit CPU cannot run 64-bit programs. On Windows, 32-bit apps run through WOW64 (Windows on Windows 64) translation layer. macOS dropped 32-bit support entirely from Catalina.

Pointer doubling from 4 to 8 bytes means 64-bit programs use ~30% more memory. Negligible now that servers have 64+ GB RAM, but matters on embedded devices with KB-level memory.

## Which one do you actually build for?

32 vs 64 is settled (everything is 64). The live decision today is two other axes, and getting either wrong means the binary will not run.

**1. CPU family: x86-64 (amd64) vs arm64 (aarch64).** Different families, **not** compatible. amd64 = Intel / AMD; arm64 = Apple Silicon, AWS Graviton, most phones. A binary built for one will not run on the other \u2014 that is the Docker / Fargate \`exec format error\`. (Go: set \`GOARCH=amd64\` or \`arm64\`.)

**2. libc: glibc (gnu) vs musl.** Normal Linux (Ubuntu, Debian) uses glibc; Alpine uses musl. A glibc-linked binary will not run on Alpine \u2014 that is why the multi-stage card sets \`CGO_ENABLED=0\`, to make a static Go binary that needs no libc.

So a native binary is pinned by **three things: OS + CPU arch + libc**. Real example: Rollup went native (Rust) in v4, so a project lists three prebuilt binaries:

| binary | OS | arch | libc | runs on |
|---|---|---|---|---|
| \`x64-gnu\` | linux | amd64 | glibc | normal Linux, standard node images |
| \`arm64-gnu\` | linux | arm64 | glibc | Graviton, Apple Silicon containers |
| \`x64-musl\` | linux | amd64 | musl | Alpine images |

Same OS, differing only on arch and libc. There is no fourth (\`arm64-musl\`) only because nothing here runs ARM Alpine.`},{title:'The "d" in dockerd \u2014 Daemon',tag:"docker",body:`A daemon is a background process not controlled through a GUI. The "d" suffix is naming convention.

| Name | Role |
|---|---|
| \`dockerd\` | Manages containers (high level), handles CLI requests |
| \`containerd\` | Container runtime, manages container lifecycle (low level) |
| \`httpd\` | Apache's HTTP server |
| \`systemd\` | Linux's main daemon, manages all other daemons |

\`dockerd\` \u2192 gRPC \u2192 \`containerd\`

Daemons communicate through IPC (unix socket or HTTP/gRPC). In k8s, containerd is CRI-compliant \u2014 Kubernetes sets the spec (CRI, CNI, CSI), experts build implementations.`},{title:"Python Execution Tools",tag:"python",body:`Performance ranking: Static/AOT > JIT compilation > JIT implementation > Interpreter

| Tool | Type | Feature |
|---|---|---|
| Cython | Static/AOT | Python \u2192 C/C++, static type declaration |
| Nuitka | Static/AOT | Python \u2192 C, produces executables |
| Numba | JIT Compiler | Compiles numerical computation, can do partial AOT |
| PyPy | JIT Implementation | Fully CPython compatible, usually faster |
| CPython | Interpreter + JIT (3.13+) | The default \`python\`. 3.15 JIT: 5-9% faster, register allocation, LLVM 21 |

CPython 3.13 (2024) introduced experimental JIT via PEP 744. By 3.15 (2026), it achieves 5-6% speedup on x86-64 Linux, 8-9% on AArch64 macOS. CPython is no longer a pure interpreter.

Packaging: \`PyInstaller\` / \`Nuitka\` \u2192 standalone executable. \`Poetry\` / \`setuptools\` \u2192 library distribution (needs interpreter).`},{title:"go install vs go get",tag:"go",body:"Before Go 1.16, `go get` did both dependency management and binary installation. This caused confusion. Go 1.16+ separated them.\n\n| | `go install` | `go get` |\n|---|---|---|\n| Purpose | Install binary to `$GOPATH/bin` | Update dependencies in `go.mod` |\n| npm equivalent | `npm i --global` | `npm i --save` |\n| Affects go.mod | No | Yes |\n\nCloning a project:\n- `go build` \u2014 downloads and compiles\n- `go mod download` \u2014 downloads only (useful in Docker to separate layers)\n- `go mod vendor` \u2014 copies deps into project `vendor/` (for offline or air-gapped environments)\n\n`$GOPATH` role changed: from core dependency path to mainly storing cache (`pkg/mod/`) and binaries (`bin/`)."},{title:"Primary vs Secondary Group Membership",tag:"cli",body:`You're in the staff group. \`id\` confirms it: \`gid=20(staff)\`. But \`dscl . -read /Groups/staff GroupMembership\` doesn't list you. Bug?

No. Membership is recorded in two places:

| Where | What | How to query |
|---|---|---|
| User record | Your **primary** group (gid) | \`id <user>\` |
| Group record | **Secondary** members added later | \`dscl . -read /Groups/staff GroupMembership\` |

Concrete:

| User | Primary | Also added to staff |
|---|---|---|
| Alice | staff | \u2014 |
| Bob | admin | staff |

Querying \`/Groups/staff\` returns Bob only. Alice's staff identity lives in **Alice's own record**, not the group's roster.

Like a basketball team: original members are recorded on their personal "joined the team" cert. Outside hires are written into the team's roster. Reading the team roster only shows hires.

The trap: a script enumerating "all staff users" by reading GroupMembership misses everyone whose primary is staff.

Linux works the same \u2014 \`getent group staff\` skips users whose primary is staff. Mechanism differs (NSS + \`/etc/passwd\` vs Open Directory), model is identical.

\`\`\`bash
# macOS
dscl . -read /Users/$(whoami)
dscl . -read /Groups/staff

# Linux
getent passwd $(whoami)
getent group staff
\`\`\``},{title:"find -exec \\; vs +",tag:"cli",body:'Same goal, different speed.\n\n```bash\nfind . -name "*.txt" -exec ls {} \\;\n# Runs once per file (sequentially):\n# ls a.txt\n# ls b.txt\n# ls c.txt\n\nfind . -name "*.txt" -exec ls {} +\n# Runs once for all files:\n# ls a.txt b.txt c.txt\n```\n\n`{}` is where the filename gets plugged in. `\\;` and `+` mark where `-exec` ends.\n\n**Why `\\;` is slow.** It forks one new process per file. 1000 `.txt` \u2192 1000 forks back-to-back (not parallel \u2014 each waits for the previous to finish). Process startup overhead adds up.\n\n**Why `+` is fast.** find collects all matches first, forks once, hands the whole list as arguments. 1000 files \u2192 1 fork.\n\n**Why escape the `;`?** Bare `;` is the shell\'s own command separator. `\\;` tells the shell "leave this for find to handle."\n\n**When to pick which:**\n\n- `+` whenever possible \u2014 fewer forks, faster. For `rm`, `ls`, `grep`, even `rm -i` (rm itself loops over args and prompts per file).\n- `\\;` only when `{}` needs to appear more than once: `mv {} {}.bak`. `+` requires `{}` at the very end, so renaming patterns like this only work with `\\;`.'},{title:"which vs where vs type vs command -v",tag:"cli",body:`PATH commonly contains multiple dirs. The same binary can live in several \u2014 system default, package manager, your own build. Which one runs first?

| Command | Platform | Output |
|---|---|---|
| \`which\` | Unix-like (Linux, macOS) | First match in PATH (the one that runs) |
| \`where\` | Windows native, also on macOS | All matches in PATH |
| \`type\` | Shell builtin (bash, zsh) | First match + whether it's alias / function / builtin / file |
| \`command -v\` | POSIX standard | First match, portable across shells and systems |

\`\`\`bash
which python3
# /opt/homebrew/bin/python3

where python3       # macOS / Windows
# /opt/homebrew/bin/python3
# /usr/bin/python3

type python3        # bash/zsh builtin
# python3 is /opt/homebrew/bin/python3

type ll             # ll is an alias
# ll is aliased to 'ls -l'

command -v python3
# /opt/homebrew/bin/python3
\`\`\`

When \`which\` returns the wrong binary, run \`where\` to see all candidates, then reorder PATH or rename the offender.

For shell scripts, prefer \`command -v\` \u2014 POSIX guarantees it; \`which\` has subtle differences across systems and might not be installed in minimal containers.`},{title:"wget vs curl",tag:"cli",body:`Both download from URLs. Different design lineage.

| | wget | curl |
|---|---|---|
| Origin | GNU, mirror-tool DNA | libcurl + CLI wrapper |
| Protocols | HTTP/S, FTP/S (FTPS since 1.17, Nov 2015) | DICT, FILE, FTP/S, GOPHER, HTTP/S, IMAP/S, LDAP/S, MQTT, POP3/S, RTMP/S, RTSP, SCP, SFTP, SMB/S, SMTP/S, TELNET, TFTP, WS/S |
| Recursive download | \`wget -r\` mirrors a site | No |
| Default output | Saves to disk | Prints to stdout |
| Form | Standalone binary | \`libcurl\` embedded in countless apps |

Use wget when: mirroring a site or pulling a directory tree.

Use curl when: anything else. API testing, scripted transfers, protocols beyond HTTP.

curl's real moat isn't the CLI. It's \`libcurl\`: git, PHP, Photoshop, and thousands of apps link against it. wget has no library form. That's why curl ships everywhere.`},{title:"Dockerfile CMD vs ENTRYPOINT",tag:"docker",body:'Dockerfile commands have two forms:\n\n```dockerfile\nRUN echo $HOME                    # shell form\nENTRYPOINT ["echo", "Hello"]      # exec form, JSON array\n```\n\nExec form is parsed as JSON. Use double quotes only.\n\n## CMD as ENTRYPOINT\'s "default arguments"\n\n```dockerfile\nENTRYPOINT ["echo", "Hello"]\nCMD ["World"]\n```\n\n| Run command | Output | Why |\n|---|---|---|\n| `docker run myimage` | `Hello World` | CMD provides default args |\n| `docker run myimage Earth` | `Hello Earth` | extra args replace CMD |\n| `docker run --entrypoint echo myimage Hi` | `Hi` | `--entrypoint` replaces ENTRYPOINT |\n\nWithout ENTRYPOINT, CMD takes full control. Only the last CMD in the Dockerfile is effective.\n\n## The PID 1 signal trap\n\nShell form silently wraps your command in `/bin/sh -c`:\n\n```dockerfile\nENTRYPOINT ["/bin/sh", "-c", "./main"]\n```\n\nNow `/bin/sh` is PID 1. Your real process is its child. When you Ctrl+C the container, SIGINT goes to PID 1.\n\nTwo problems compound:\n\n1. The kernel treats PID 1 specially. It ignores SIGTERM/SIGINT by default unless explicitly handled.\n2. Shells don\'t auto-forward signals to child processes.\n\nResult: Ctrl+C does nothing. `docker stop` falls back to `docker kill` after a 10-second timeout.\n\n## The fix\n\nUse exec form so your actual process becomes PID 1:\n\n```dockerfile\nENTRYPOINT ["./main"]\n```\n\nIf you need shell features (variable expansion, `&&`), use exec form with bash explicitly:\n\n```dockerfile\nENTRYPOINT ["/bin/bash", "-c", "echo $HOME && ./main"]\n```\n\nOr use a tiny init like `tini`:\n\n```dockerfile\nRUN apk add tini\nENTRYPOINT ["tini", "--", "./start.sh"]\n```\n\n`tini` reaps zombies and forwards signals to children, fixing both PID 1 issues.'},{title:"Dockerfile COPY vs ADD",tag:"docker",body:`\`COPY\` does one thing: copy local files from the build context into the image.

\`ADD\` does that plus two "magics" that bite you.

| Behavior | COPY | ADD |
|---|---|---|
| Local file copy | \u2705 | \u2705 |
| Auto-extract tar | \u274C | \u2705 (only \`.tar\`, \`.tar.gz\`, \`.tar.bz2\`, \`.tar.xz\`) |
| Fetch from URL | \u274C | \u2705 (no response caching, no checksum, no retry) |
| \`--from\` (multi-stage) | \u2705 | \u2705 |

## The auto-extract trap

Identical-looking lines, different behavior by extension:

\`\`\`dockerfile
ADD release.tar.gz /opt/    # auto-extracted, .tar.gz gone
ADD release.zip /opt/        # NOT extracted, .zip preserved
\`\`\`

Someone changes the bundle from tar.gz to zip. Dockerfile unchanged. Image content shifts. Hours of debugging.

## The URL trap

\`\`\`dockerfile
ADD https://example.com/script.js /app/
\`\`\`

Looks convenient. Reality:

- Layer cache key is the URL string, not the response. URL same but content changed? Cache hits, you get a stale file.
- No retry, no timeout, no checksum.
- No way to react to errors mid-build.

## The build context trap (both)

Both \`COPY\` and \`ADD\` cannot escape the build context:

\`\`\`dockerfile
COPY ../file.txt /app/    # build fails
ADD  ../file.txt /app/    # build fails
\`\`\`

The directory you ran \`docker build\` in is the ceiling. Solve by reorganizing: move files into the context, or build from a higher directory and use \`COPY subdir/file ...\`.

## The fix

Default to \`COPY\` always. Use explicit \`RUN\` for the magic:

\`\`\`dockerfile
COPY release.tar.gz /tmp/
RUN tar -xzf /tmp/release.tar.gz -C /opt && rm /tmp/release.tar.gz

RUN curl -fsSL -o /app/script.js https://example.com/script.js
\`\`\`

\`COPY\` behavior is consistent regardless of file extension.

## The killer feature: \`COPY --from\`

\`\`\`dockerfile
FROM golang:1.22 AS builder
WORKDIR /src
COPY . .
RUN go build -o main .

FROM alpine:latest
COPY --from=builder /src/main /usr/local/bin/main
\`\`\`

Multi-stage build essential. Pull artifact from a previous stage without dragging the whole toolchain into the final image. Final image stays tiny.`},{title:"docker compose up/down vs start/stop",tag:"docker",body:'Two axes that get confused:\n\n| Pair | What it does |\n|---|---|\n| `up` / `down` | Create / destroy (containers, network, default volumes) |\n| `start` / `stop` | On / off existing containers |\n\n```bash\ndocker compose up        # create containers if missing, start them\ndocker compose down      # stop and REMOVE containers + network\ndocker compose start     # start containers that exist (run `up` first)\ndocker compose stop      # stop running containers, keep them around\ndocker compose pause     # freeze process state (SIGSTOP)\n```\n\nMental model: `up` / `down` is "do you exist?". `start` / `stop` is "are you running?".\n\n## down\'s destructive flags\n\n```bash\ndocker compose down                  # remove containers + network\ndocker compose down --volumes        # also remove named volumes\ndocker compose down --rmi local      # also remove images built locally\ndocker compose down --rmi all        # also remove all images, including pulled\n```\n\n`--volumes` is the dangerous one. It kills your DB data if it lives in a named volume.\n\n## When to use each\n\n| Goal | Command |\n|---|---|\n| Daily dev cycle (keep state) | `stop` / `start` |\n| Reset everything (fresh state) | `down --volumes` then `up` |\n| Restart one service | `docker compose restart <service>` |\n| Pull new image and rebuild | `docker compose up --build` |\n\nNote: `docker compose` (with space) is the v2 plugin, included in modern Docker. `docker-compose` (with hyphen) is the legacy v1 standalone binary, deprecated.'},{title:"Dockerfile EXPOSE is just documentation",tag:"docker",body:`\`EXPOSE\` does NOT publish ports or change network behavior. It is metadata, signaling intent.

\`\`\`dockerfile
EXPOSE 8080
\`\`\`

This tells humans (and some tools) "the service inside listens on 8080". It does not:

- Open the port to the host
- Map anything to the outside world
- Change firewall or iptables rules

The actual service port is whatever the program inside the container binds to. \`EXPOSE\` and the program's listen port can disagree, and the program wins.

## Real port mapping happens at run time

\`\`\`bash
docker run -p 80:80 myimage             # host 80 to container 80
docker run -p 3009:8080 myimage         # host 3009 to container 8080
docker run -p 127.0.0.1:80:80 myimage   # bind only to loopback
\`\`\`

The \`-p HOST:CONTAINER\` flag is what actually opens a port on your host and forwards traffic into the container. EXPOSE is irrelevant to this.

## Where EXPOSE matters slightly

- \`docker run -P\` (capital P): publishes ALL exposed ports to random host ports.
- Cloud orchestrators (ECS, k8s with some configs) may read EXPOSE as a hint, but most require explicit port config anyway.

## Bottom line

Write \`EXPOSE\` for documentation. Always set actual port mapping with \`-p\` (or service config in compose / k8s manifest). Don't expect \`EXPOSE\` alone to do anything network-level.`},{title:"ns, \u03BCs, ms \u2014 Time Unit Conversion",tag:"concepts",body:`| Unit | Full name | Seconds | Relation |
|---|---|---|---|
| 1 ns | nanosecond | 0.000000001 s | 1 |
| 1 \u03BCs | microsecond | 0.000001 s | = 1,000 ns |
| 1 ms | millisecond | 0.001 s | = 1,000 \u03BCs = 1,000,000 ns |
| 1 s | second | 1 s | = 1,000 ms |

## System design reference latencies

| Operation | Latency | Unit |
|---|---|---|
| CPU register | ~1 ns | |
| L1 cache | ~1 ns | |
| L2 cache | ~4 ns | |
| RAM access | ~100 ns | |
| Redis GET (local) | ~100 ns - 1 \u03BCs | in-process |
| Redis GET (network) | ~0.5 ms | over network |
| SSD random read | ~100 \u03BCs | = 1,000x slower than RAM |
| HDD random read | ~10 ms | = 100,000x slower than RAM |
| DB query (SSD + network) | ~1-10 ms | |
| Cross-region network | ~50-150 ms | |

1 ms of DB query = 10,000 RAM accesses. This is why caches (Redis, Bloom filter, Memtable) exist.`},{title:"\u4E09\u500B Driven \u4E0D\u662F\u540C\u4E00\u56DE\u4E8B",tag:"concepts",body:`DDD / TDD / BDD \u90FD\u5E36 Driven\u3002\u4F46 driven \u7684\u5C0D\u8C61\u5728\u4E0D\u540C\u5C64\u6B21\uFF0C\u6DF7\u5728\u4E00\u8D77\u8B1B\u8AB0\u90FD\u4E0D\u6703\u505A\u597D\u3002

| | Driven by | \u89E3\u7684\u554F\u984C |
|---|---|---|
| **DDD** (Domain-Driven Design) | \u696D\u52D9\u9818\u57DF | code \u8A72\u600E\u9EBC**\u7D44\u7E54** |
| **TDD** (Test-Driven Development) | \u6E2C\u8A66 | \u5BEB code \u7684**\u7BC0\u594F** |
| **BDD** (Behavior-Driven Development) | business-readable spec | test \u8A72**\u8B93\u8AB0\u770B\u5F97\u61C2** |

## DDD

\u8A2D\u8A08\u88AB\u696D\u52D9\u9818\u57DF\u9A45\u52D5\uFF0C\u4E0D\u662F\u88AB framework / DB / UI \u9A45\u52D5\u3002\u5DE5\u5177: Ubiquitous Language\uFF08\u696D\u52D9\u8DDF code \u7528\u540C\u4E00\u5957\u8A5E\uFF09\u3001Bounded Context\uFF08\u540C\u8A5E\u5728\u4E0D\u540C\u5B50\u9818\u57DF\u610F\u7FA9\u4E0D\u540C\uFF09\u3001Aggregate Root\uFF08entity \u7FA4\u7D44\u8001\u5927\uFF09\u3001Repository Pattern\u3002

\u89E3\u7684\u662F\u300Ccode \u8A72\u600E\u9EBC\u7D44\u7E54\u624D\u80FD\u53CD\u6620\u8907\u96DC\u696D\u52D9\u300D\u3002\u4E0D\u95DC\u5FC3\u600E\u9EBC\u5BEB code \u7684\u6B65\u9A5F\u3002

## TDD

\u5BEB code \u7684\u9806\u5E8F\u88AB test \u9A45\u52D5\u3002Red\uFF08fail test\uFF09\u2192 Green\uFF08\u904E test\uFF09\u2192 Refactor\u3002\u8A2D\u8A08\u5F9E test \u6F14\u5316\u51FA\u4F86\u3002

\u89E3\u7684\u662F\u300C\u5BEB code \u7684\u6B65\u9A5F\u8A72\u600E\u9EBC\u7DE8\u6392\u300D\u3002\u4E0D\u95DC\u5FC3 domain \u662F\u4EC0\u9EBC\u3002

## BDD

TDD \u52A0\u8A9E\u8A00\u5C64: test \u5F9E\u5DE5\u7A0B\u5E2B\u770B\u5F97\u61C2\u8B8A\u6210\u696D\u52D9\u770B\u5F97\u61C2\u3002Cucumber/Gherkin \u98A8\u683C:

\`\`\`
Feature: Calculator addition
  Scenario: Adding two positive numbers
    Given a calculator
    When I add 2 and 3
    Then the result should be 5
\`\`\`

\u89E3\u7684\u662F\u300Ctest \u8A72\u8B93\u8AB0\u8B80\u5F97\u61C2\u300D\u3002\u4E0D\u95DC\u5FC3\u6E2C\u8A66\u7BC4\u570D\u6216\u7BC0\u594F\u3002

## \u4E09\u8005\u7684\u4F4D\u7F6E

\`\`\`
    \u696D\u52D9 \u2190\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2192 \u6280\u8853
    DDD                            TDD
   (\u8A9E\u8A00\u3001\u908A\u754C\u3001\u6A21\u578B)            (\u7BC0\u594F\u3001refactor\u3001\u55AE\u5143)
                BDD
                (\u7528\u696D\u52D9\u8A9E\u8A00\u5BEB test)
                \u6A4B\u5728 DDD \u8DDF TDD \u4E2D\u9593
\`\`\`

## \u6700\u7C21\u55AE\u7684\u8A18\u6CD5

- **DDD** = \u8EDF\u9AD4\u8A72**\u600E\u9EBC\u9577**
- **TDD** = \u5BEB\u7684\u904E\u7A0B**\u600E\u9EBC\u9032\u884C**
- **BDD** = test **\u8B93\u8AB0\u770B**

\u4E09\u500B\u662F\u758A\u52A0\uFF0C\u4E0D\u662F either-or\u3002\u554F\u300CDDD vs TDD\u300D\u50CF\u554F\u300C\u8173\u8E0F\u8ECA vs \u8DD1\u6B65\u6A5F\u300D: \u4E00\u500B\u662F\u4EA4\u901A\u65B9\u5F0F\u3001\u4E00\u500B\u662F\u5065\u8EAB\u65B9\u5F0F\uFF0C\u4E0D\u885D\u7A81\u4E5F\u4E0D\u66FF\u4EE3\u3002

## BDD \u7684\u96B1\u6027\u6210\u672C

\u7406\u8AD6\u4E0A BDD \u7F8E\u597D\uFF0C\u5BE6\u52D9\u4E0A\u591A\u6578\u5718\u968A\u4E0D\u505A\u5B8C\u6574 BDD:

1. Cucumber/Gherkin \u5DE5\u5177\u93C8\u91CD\uFF0Cspec \u89E3\u6790 + step definition + fixture \u7BA1\u7406\uFF0C\u8907\u96DC\u5EA6\u6BD4\u76F4\u63A5 unit test \u9AD8 3-5 \u500D
2. PM \u901A\u5E38\u4E0D\u771F\u7684\u8B80 feature file\u300290% \u7684\u5718\u968A\u63A8 BDD\uFF0CPM \u770B\u5169\u9031\u653E\u68C4\uFF0C\u6700\u5F8C\u53EA\u5269\u5DE5\u7A0B\u5E2B\u7DAD\u8B77

\u591A\u6578\u516C\u53F8\u505C\u5728\u300CBDD-flavored TDD\u300D: \u5BEB test \u6642\u7528 Given/When/Then \u547D\u540D\u7FD2\u6163\uFF0C\u4F46\u4E0D\u4E0A Cucumber\u3002`},{title:"AWS Analytics: Athena, Redshift, Kinesis, EMR",tag:"aws",body:`Every analytics stack is the same shape: **ingest \u2192 process \u2192 store \u2192 query**. Pick the service by which stage it covers and whether it runs in real-time.

| Service | SQL | Real-time | Role |
|---|---|---|---|
| Kinesis Data Streams | | \u2705 | raw real-time ingest |
| Amazon Data Firehose | | near | buffer + reshape a stream, deliver to S3 / Redshift / OpenSearch (formerly Kinesis Data Firehose) |
| Managed Service for Apache Flink | \u2705 | \u2705 | SQL/Flink over the live stream (formerly Kinesis Data Analytics) |
| Amazon MSK | | \u2705 | managed Kafka, high-throughput transactional |
| Athena | \u2705 | | query any-format data sitting in S3, ad-hoc |
| Redshift | \u2705 | near | OLAP warehouse, business-logic analysis |
| EMR | \u2705 (Hive/Spark) | \u2705 | the heavy one \u2014 complex processing, ML |
| Glue | \u2705 | | automated ETL + Data Catalog |
| Lake Formation | | | governance + access control over a data lake |

Quick pick: complex processing \u2192 EMR. Financial / security streams \u2192 MSK. Simple real-time \u2192 Kinesis Data Streams. Ad-hoc on S3 \u2192 Athena. Department warehouse \u2192 Redshift.

## Same shape, different fillings

\`\`\`
real-time:  Kinesis Streams \u2192 Managed Flink \u2192 S3 \u2192 Athena
batch ETL:  S3 \u2192 Glue ETL \u2192 Redshift \u2192 Athena
data lake:  Data Firehose \u2192 S3 \u2192 Lake Formation \u2192 Athena
\`\`\`

Once you see ingest \u2192 process \u2192 store \u2192 query, every pipeline is the same four boxes with different services dropped in.`},{title:"AWS Security vs Governance \u2014 the 3 exceptions",tag:"aws",body:`AWS scatters a dozen audit / protection services across two console categories. The shortcut: **only three are "Management & Governance" \u2014 CloudTrail, Config, Trusted Advisor. Everything else is "Security, Identity & Compliance."**

| Service | What it does | Category |
|---|---|---|
| **CloudTrail** | who did what \u2014 API call history | Mgmt & Gov |
| **Config** | does a resource's config break a rule | Mgmt & Gov |
| **Trusted Advisor** | unused resources, recommendations (won't force you) | Mgmt & Gov |
| Shield | DDoS protection (CloudFront / R53 / ELB) | Security |
| WAF | L7 filtering \u2014 IP, geo, XSS, SQLi | Security |
| Security Hub | central dashboard, aggregates the others | Security |
| Audit Manager | regulatory compliance (GDPR / HIPAA) | Security |
| Inspector | scans EC2 / ECR / Lambda for vulnerabilities | Security |
| Macie | scans S3 for sensitive data | Security |
| GuardDuty | threat detection over logs | Security |

Mnemonics: see "compliance" in a question \u2192 Audit Manager. "Hub" \u2192 Security Hub. GuardDuty doesn't protect, it *watches* \u2014 it reads CloudTrail logs, VPC Flow Logs, and Route53 DNS logs and flags threats, no setup needed.`},{title:"AWS Migration: volume \xD7 online/offline",tag:"aws",body:`The right migration tool is a function of two axes: **how much data**, and **online (over the wire) vs offline (shipped on hardware)**. The offline half has shrunk a lot \u2014 AWS spent 2024 retiring most of it.

## Online \u2014 needs a connection (the living half)

| Tool | Use |
|---|---|
| DataSync | file sync; AWS's current default for most transfers |
| Transfer Family | SFTP / FTP / FTPS, async |
| DMS | DB migration \u2014 one-time or continuous (CDC) |
| MGN (App Migration) | agent on source, step replication, rollback |
| Storage Gateway | hybrid \u2014 Volume (iSCSI) / File (NFS\xB7SMB) / Tape (VTL) |

## Offline \u2014 the Snow Family got cut down

- **Snowmobile** (the 100 PB shipping-container truck) \u2014 retired in 2024.
- **Snowcone** and the older Snowball Edge models (80 TB Storage Optimized, 52-vCPU and GPU Compute) \u2014 discontinued Nov 12 2024; existing-customer support ends Nov 12 2025.
- **Still available to everyone:** Snowball Edge Storage Optimized 210 TB (NVMe, ~1.5 GB/s, with a 100 TB price tier) and Compute Optimized (104 vCPU, 416 GB RAM, 28 TB SSD).

AWS now steers most migrations to **DataSync**, reaching for the 210 TB box only when bandwidth is the bottleneck. Edge compute \u2192 the 104-vCPU box or **Outposts**.

## Picking by volume

\`\`\`
< TB   \u2192 DataSync over the internet
TBs    \u2192 DataSync + Direct Connect (dedicated line)
PB+    \u2192 Snowball Edge 210 TB boxes in parallel (Snowmobile is gone)
\`\`\`

By use case: DB \u2192 DMS. File server \u2192 DataSync / Storage Gateway. App server \u2192 MGN. Keep-in-sync \u2192 DataSync / DMS.`},{title:"docker system prune: what each flag deletes",tag:"docker",body:"`docker system prune` cleans up, but what it removes depends on the flag. The trap is two pairs of nested terms: **dangling \u2282 unused**, and **IIL \u2282 builder cache**.\n\n- **Dangling image**: a build with no tag, shows `<none>`. You rebuilt, and the old untagged layer is now dangling.\n- **Unused image**: any image no container uses (including stopped ones). Dangling images are unused; unused images are not all dangling.\n\n| Command | Removes |\n|---|---|\n| `docker system prune` | stopped containers, unused networks, **dangling** images + build cache |\n| `docker system prune -a` | the above **+ all unused images** (not just dangling) |\n| `docker system prune --volumes` | the above + unused volumes (the dangerous one: kills DB data) |\n| `docker builder prune` | the **whole** build cache, not just dangling: IILs + source / dependency / temp caches |\n\n**IIL (Intermediate Image Layer)**: each Dockerfile instruction makes one (see `docker history`). **Builder cache** is broader: IILs plus other build-time data. So `system prune` only nibbles the dangling; `builder prune` clears the lot."},{title:"AWS snapshot vs backup",tag:"aws",body:`The reliable split is **automatic vs manual**, not the words "snapshot" and "backup" \u2014 those are used inconsistently across services.

| | automatic | manual |
|---|---|---|
| Retention | AWS-managed (e.g. 1-35 days) | none, kept until **you** delete |
| Deletion | auto-deleted past retention; **gone when you delete the DB/cluster** | survives resource deletion |
| Shareable | no | yes |
| For | point-in-time recovery, HA | keep a specific state long-term |

**The label does not tell you the lifecycle:**

- **RDS**: \`automated backup\` (the automatic one) vs \`manual snapshot\` (the you-control one).
- **DocumentDB / Neptune**: \`automatic snapshot\` vs \`manual snapshot\` (both called "snapshot").

So in RDS the *backup* is the AWS-managed one and the *snapshot* is the you-control one \u2014 the opposite of what the words suggest. Don't infer from the name; ask **does AWS delete it on a schedule, or do you?**

## Storage and cost

These live in **AWS-managed S3**: invisible in your S3 console, billed under the owning service (not as a bucket you see). You still pay **per GB-month**, but **RDS/Aurora give a free allowance equal to your DB size** (automatic + manual combined, per region); only the excess is charged. EBS snapshots have no free allowance.`},{title:"AWS managed vs serverless: one question",tag:"aws",body:`AWS's spectrum from self-managed to serverless sounds fuzzy, but the line between the top tiers is one question.

- **Fully managed**: AWS handles patching, networking, security. **You still size the resources** (CPU, memory, count). e.g. RDS, OpenSearch Service.
- **Serverless**: you do not even size resources, AWS auto-scales. e.g. Lambda, Fargate, S3, DynamoDB, Aurora Serverless.

**The discriminator: do you adjust the resources?** No \u2192 serverless. And **every serverless service is also fully managed** (serverless is a strict subset).

Two traps:
- **Managed-ness does not inherit to features.** RDS is fully managed, yet a *manual snapshot* needs your hand. VPC is self-managed, yet *VPC Flow Logs* are handled by AWS. Judge per feature, not per service.
- EC2, and anything you run on EC2, is **not** managed. That is the self-managed end.`},{title:"Dockerfile: which instructions make a layer",tag:"docker",body:"Only three instructions create a real filesystem layer (one with size): **`RUN`, `COPY`, `ADD`**. They change the filesystem.\n\nEverything else (`CMD`, `ENTRYPOINT`, `ENV`, `ARG`, `LABEL`, `EXPOSE`, `USER`, `WORKDIR`, `VOLUME`, `HEALTHCHECK`...) only writes **metadata** to the image config. In `docker history` each shows a row, but **0B**.\n\n`FROM` does not create a layer of its own; it pulls in the base image's existing layers and starts a stage.\n\nWhy it matters:\n\n- **Disk and `prune`**: the sized layers are RUN/COPY/ADD; metadata costs nothing.\n- **Cache is a chain**: change any line, even an `ENV`, and every layer after it rebuilds. Put stable steps (install deps) early, volatile ones (COPY source) late.\n- Old Docker made every instruction a layer; modern BuildKit only RUN/COPY/ADD. `docker history` listing them all is what confuses people."},{title:"Dockerfile ARG vs ENV",tag:"docker",body:"`ARG` lives only during `docker build`. `ENV` lives at build time **and** persists into the image and the running container.\n\n| | `ARG` | `ENV` |\n|---|---|---|\n| Available | build only | build + runtime |\n| Set by | `--build-arg X=v` | `ENV X=v`, override with `docker run -e` |\n| In final image | no | yes, the app reads it |\n| Before / in the `FROM` line | yes (only instruction allowed there) | no (errors) |\n| In `RUN` as env var | yes (build only) | yes, and it stays |\n| Use for | base tag, build flags, versions | `PORT`, `NODE_ENV`, paths |\n\n**Scope**\n\n- Within a stage, both flow to later instructions.\n- Across a new `FROM`, neither carries; re-declare. Only files cross, via `COPY --from`.\n- A global `ARG` (before `FROM`) reaches the `FROM` line but not the stage body; re-declare `ARG` inside to use it.\n- Same name: `ENV` beats `ARG` during build. To bake a build value: `ARG VER` then `ENV APP_VER=$VER`.\n\n**Cache**\n\n- Change an `ENV` value: everything after that line rebuilds.\n- Change an `ARG` value: rebuild starts at the first instruction that *uses* it (declaring it alone is cheap).\n\n**Built-in ARGs (no declaration needed)**\n\n- Proxy: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`... the one exception that stays *out* of `docker history` and does not bust cache.\n- BuildKit platform: `TARGETPLATFORM`, `TARGETARCH`, `BUILDPLATFORM`...\n- `ENV` has none of these.\n\n**Secrets: neither is safe, `ENV` is worse**\n\n| Leaks in | `ARG` | `ENV` |\n|---|---|---|\n| `docker history` | yes (prefixed on RUN layers in scope) | yes |\n| `docker inspect` | no | yes (`Config.Env`) |\n| running container | no | yes |\n\n`ENV` leaks in all three; `ARG` only in history. For real secrets use BuildKit `--secret` mounts: they never land in any layer. Bonus: an `ARG` used only in a builder stage and not copied forward won't appear in the final image's history, but that's not a substitute for `--secret`."},{title:"docker image anatomy",tag:"docker",body:"An image is not one blob. It is read-only filesystem layers + a config JSON + a manifest that ties them together.\n\n```\nimage\n\u251C\u2500 manifest      layer digests + config digest\n\u251C\u2500 config JSON\n\u2502   \u251C\u2500 Config.Env / Cmd / Entrypoint / ExposedPorts ...  (runtime settings)\n\u2502   \u251C\u2500 history[]   one entry per layer: CreatedBy, created, size\n\u2502   \u251C\u2500 rootfs.diff_ids   ordered layer digests\n\u2502   \u2514\u2500 Architecture / Os\n\u2514\u2500 layers        the actual files, each a tar diff, addressed by sha256\n```\n\n| Part | Holds | Read by |\n|---|---|---|\n| layers | the files | the container filesystem |\n| Config.Env / Cmd / Entrypoint | runtime behavior | `docker inspect`, the container |\n| history[] | build trace (CreatedBy per layer) | `docker history` |\n| manifest / digests | what to pull, dedup | registry, `docker pull` |\n\n- Layers are content-addressed (sha256) and **shared between images**: pull only what you lack.\n- Only `RUN`/`COPY`/`ADD` make a sized layer; metadata instructions add a 0B layer + a `history[]` entry.\n- `ENV` value lives in `Config.Env` (runtime). `ARG` value only leaves a trace in `history[]` (build), never in `Config.Env`.\n- The config JSON **travels with the image**, so `history[]` ships to whoever pulls it. That is why build-args leak."},{title:"docker history vs docker inspect",tag:"docker",body:"Two views of one image: `history` shows **how it was built**, `inspect` shows **what it is**.\n\n| | `docker history` | `docker inspect` |\n|---|---|---|\n| Target | image only | image **or** container |\n| Reads | `history[]` + per-layer size | `config` + rootfs + (container) state |\n| Shows | layer stack + the instruction per layer | full config JSON + runtime state |\n| Shape | table, one row per layer | one big JSON object |\n| Size | **per-layer** | image total only |\n| Env vars | text inside the `ENV` instruction | structured `Config.Env` |\n| Reach for it to | find fat layers, spot leaked build-args | read entrypoint / env / ports / mounts / IP |\n\n## Where ARG / ENV show up\n\n| Value in | `history[]` | `Config.Env` | running container |\n|---|---|---|---|\n| ENV | yes | yes | yes |\n| ARG | yes (if used in final stage) | no | no |\n\n`docker inspect` shows ENV but never ARG; `docker history` shows both (ARG via the RUN-layer prefix). A build-arg is not in the runtime config, yet still ships inside `history[]`: anyone who pulls the image can read it. See the **docker image anatomy** card for where each part lives."},{title:"Docker multi-stage build: shrink a fat image",tag:"docker",body:`A single-stage build ships everything: base image, compiler, source, and the binary. A Go app built this way is ~800MB. Multi-stage compiles in one stage, then copies only the binary into a tiny base.

**Before \u2014 one stage, ships the whole toolchain (~800MB)**

\`\`\`dockerfile
FROM golang:1.22
WORKDIR /app
COPY . .
RUN go build -o main .
CMD ["./main"]
\`\`\`

**After \u2014 builder stage discarded, only the binary survives (~15MB)**

\`\`\`dockerfile
FROM golang:1.22 AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -o main .

FROM alpine:latest          # final image = only THIS stage
COPY --from=builder /app/main .
CMD ["./main"]
\`\`\`

Why it shrinks: the final image is **only the last stage's layers**. The fat builder stage (Go toolchain, source) is thrown away; only what you \`COPY --from\` survives. It is not compression: it splits the build environment from the runtime environment and carries just the artifact into a clean small base.

\`CGO_ENABLED=0\` makes a static binary so it runs on alpine (musl, no glibc).`},{title:"CORS: simple request vs preflight (OPTIONS)",tag:"web",body:`CORS is not a switch. It is response headers the server sends; the **browser** enforces them. The real key is *what each kind blocks, and when*.

| | preflight? | what the browser blocks |
|---|---|---|
| **simple** (GET, POST text/plain) | no | only **JS reading the response** \u2014 the request already reached the server |
| **non-simple** (POST json, PUT/DELETE, custom headers) | yes (OPTIONS first) | the **request from being sent** \u2014 withheld until the server approves |

Simple is *ask forgiveness*: it hits the server, the response is gated afterward. Non-simple is *ask permission*: a harmless OPTIONS asks first, and the real request is never sent if the server does not allow it.

## Why the asymmetry

A plain HTML form could always POST cross-origin, and \`<img>\` could always GET. Those were never preventable, so CORS does not gate them \u2014 it only controls whether your JS may read the reply. (That is also the CSRF hole: a simple cross-origin POST can still execute on the server.)

Non-simple calls (DELETE, custom auth headers, json) are new powers that fetch/XHR added. The browser refuses to send one to a server that has not opted in, protecting servers written before CORS existed.

## What counts as simple (no preflight)

All must hold:

- method is \`GET\` / \`HEAD\` / \`POST\`
- only safelisted headers, no custom ones
- Content-Type is \`x-www-form-urlencoded\`, \`multipart/form-data\`, or \`text/plain\` \u2014 **not \`application/json\`**
- no \`ReadableStream\` body, no \`xhr.upload\` listener

Break any one \u2192 non-simple \u2192 preflight.

## Both still need the header

Either way, the **actual response** needs \`Access-Control-Allow-Origin\`. Non-simple just *also* needs the OPTIONS preflight answered. On API Gateway, the "Enable CORS" button only wires the OPTIONS; your Lambda must add the header to the real response.`},{title:"API Gateway to Lambda: proxy integration",tag:"aws",body:`With **Lambda proxy integration on**, API Gateway packs the whole HTTP request into the \`event\` your Lambda receives:

\`\`\`json
{
  "httpMethod": "POST",
  "path": "/users",
  "headers": { },
  "body": "raw JSON string"
}
\`\`\`

With it **off** (non-proxy), the gateway sends only what a mapping template defines. Define nothing and Lambda gets \`{}\`, so \`event.httpMethod\` is \`undefined\` and code like \`if (event.httpMethod === 'POST')\` never matches. The classic symptom: "my event is empty / httpMethod is undefined."

| | proxy on | proxy off (non-proxy) |
|---|---|---|
| What Lambda gets | the full HTTP request, standard shape | only what your VTL mapping template builds |
| Who formats the response | Lambda returns \`{ statusCode, headers, body }\` | gateway maps Lambda's output |
| Setup | minimal | write mapping templates |

Fix for the undefined: Integration Request \u2192 Edit \u2192 turn on **Use Lambda Proxy integration**. Use proxy for most cases; non-proxy only when you need the gateway to transform the request or response.`},{title:"Lambda needs an execution role for every AWS call",tag:"aws",body:`A Lambda function cannot touch DynamoDB, S3, or any AWS service just because your code imports the SDK. Its **execution role** must carry a policy allowing that call, or the SDK throws \`AccessDenied\`.

The usual snag: Lambda runs fine, but the first DynamoDB call fails with a permissions error. The code is correct; the role is missing the permission.

Fix: open the function's execution role in IAM and attach a policy for the service.

\`\`\`
Lambda > Configuration > Permissions > (role name) > IAM > add policy
\`\`\`

**Least privilege vs lazy:**

- Lazy: attach \`AmazonDynamoDBFullAccess\`. Works, but the function can reach every table.
- Better: a policy scoped to the one table's ARN and only the actions it needs (\`dynamodb:PutItem\`, \`dynamodb:GetItem\`...).

The role is the gate. Importing the SDK is not enough; the role must allow the call.`},{title:"RISC vs CISC, and why ARM is everywhere",tag:"concepts",body:`Two instruction-set philosophies:

| | CISC | RISC |
|---|---|---|
| Idea | many complex, specialized instructions | few simple instructions, run fast |
| Examples | x86 (Intel, AMD) | ARM, RISC-V |
| Trade-off | fewer instructions per task, more work per instruction | more instructions, but each is cheap and pipelines well |

Modern x86 is really **hybrid**: CISC on the outside, but internally it cracks each instruction into RISC-like micro-ops. It borrows RISC ideas without becoming RISC.

## Why ARM is suddenly everywhere

The key is a business model, not a technical one: **ARM does not manufacture chips. It licenses the design.** So Apple, AWS, Qualcomm, and others each build their *own* custom chip on ARM's architecture. Intel and AMD, by contrast, both design and make x86 and do not license it out.

That licensing model is why custom silicon exploded: anyone can build a chip tailored to their own needs on top of ARM.

## The structural split

- **RISC / ARM** wins where energy efficiency rules: phones first, then cloud servers.
- **CISC / x86** holds desktops and traditional servers, carried by decades of compiled software.

So ARM's move into x86's territory is gated less by raw performance than by **software ecosystem compatibility** \u2014 whether the software people depend on runs well on ARM.

(Specific chip models date fast, so they are left out on purpose. The durable shape is: two philosophies, a licensing model, and an efficiency-vs-ecosystem tension.)`},{title:"libc: glibc vs musl (which base image has which)",tag:"docker",body:`\`libc\` is the C standard library: the layer between a program and the kernel. It implements \`malloc\`, file and string functions, and the wrappers around system calls. Most compiled programs \u2014 even Go, Rust, Node \u2014 link it unless built fully static.

\`\`\`
your program  \u2192  libc (malloc / fopen / socket...)  \u2192  kernel
\`\`\`

Linux has two implementations, and they are **not** interchangeable:

- **glibc** (GNU) \u2014 the standard on most distros. Full-featured, large.
- **musl** \u2014 small, static-friendly. What **Alpine** uses.

A glibc-linked binary will not run on Alpine (musl), and vice versa. Same CPU arch, different libc, will not load.

## Which base image has which

| base image | libc |
|---|---|
| alpine | **musl** |
| ubuntu, debian | glibc |
| amazonlinux | glibc |
| fedora / rhel / rocky / almalinux | glibc |
| distroless (\`gcr.io/distroless\`) | glibc (Debian-based) |
| scratch | none \u2014 binary must be fully static |
| busybox | a glibc and a musl variant exist |

In containers the choice is basically **"Alpine or not"**: Alpine means musl, everything else mainstream is glibc.

Two traps:

- **distroless is not Alpine.** It is minimal but glibc (Debian underneath). To fit a glibc binary into a tiny image, distroless is easier than fighting musl.
- **scratch has no libc at all**, so it only holds a fully static binary \u2014 the natural home for a \`CGO_ENABLED=0\` Go binary.

## Beyond Linux

glibc (mainstream Linux), musl (Alpine), **Bionic** (Android's own), and **BSD libc** (macOS, the BSDs) are all separate. When packaging a container you only meet the first two, and the decision is just whether you use Alpine.

\`CGO_ENABLED=0\` sidesteps all of this: it makes a Go binary that links no libc, so it runs on glibc, musl, or scratch alike.`},{title:"Unix family tree: UNIX vs Unix-like",tag:"concepts",body:`\`\`\`
AT&T Unix (1969, Bell Labs)  -- the original
  |-- BSD (Berkeley, 1977) -- added to, then rewrote, the AT&T code
  |     |-- FreeBSD / OpenBSD / NetBSD
  |     \`-- (via NeXTSTEP) -> Darwin -> macOS / iOS
  \`-- System V -> commercial Unix (Solaris, AIX, HP-UX)

Linux (1991, from scratch) -- no shared code, just Unix-LIKE (POSIX)
GNU   (1983, from scratch) -- the userland, "GNU's Not Unix"
\`\`\`

**"UNIX" is a certification, not a lineage.** UNIX is a trademark owned by **The Open Group**. You may call your OS UNIX only if it passes the **Single UNIX Specification (SUS)** test suite and pays \u2014 regardless of ancestry.

| | "UNIX" (certified) | "Unix-like" |
|---|---|---|
| Means | passed SUS + paid for the trademark | behaves like Unix, not certified |
| Decided by | The Open Group | nobody, just description |
| Examples | macOS, Solaris, AIX, HP-UX | Linux, the BSDs, Android |

## Three axes people conflate

- **Trademark (certified UNIX):** macOS, Solaris, AIX. Money + a test.
- **Lineage (descends from AT&T code):** BSD, macOS, Solaris. Real ancestry.
- **POSIX behavior (works like Unix):** Linux, BSD, macOS, Android. Almost the whole family.

Note the word "Unix-like" has two uses: broadly it means "behaves like Unix" (which includes macOS), but colloquially it means "behaves like Unix but **not** certified" (which excludes macOS). macOS is both: it behaves like Unix **and** is certified, so it gets the stronger label "UNIX," not "Unix-like."

The twist: certification is about money and a test, not blood. **macOS** is certified UNIX (Apple pays). **FreeBSD** has more genuine Unix ancestry yet is only "Unix-like" \u2014 nobody certified it. **Linux** has neither ancestry nor certification, but is Unix-like by design.

POSIX (IEEE) is the API standard the family follows; SUS is its superset. Conforming to POSIX is not the same as being a certified UNIX.

## Quick answers

- **macOS is BSD?** Partly \u2014 its core (Darwin) is BSD-derived, but macOS is not "a BSD."
- **macOS is Unix-like?** Stronger than that: macOS is **certified UNIX**, not merely Unix-like.
- **macOS is Linux's brother?** No. macOS descends from Unix (via BSD); Linux is a from-scratch look-alike. Not siblings.
- **Linux is Unix's child?** No. Written from scratch in 1991, no shared code \u2014 Unix-like by design, not by lineage.
- **BSD is Unix?** BSD began as patches on AT&T Unix (real Unix code), then rewrote it out. A genuine Unix descendant, but not the AT&T product itself.`},{title:'nginx to uWSGI: "Permission denied" is the user, not chmod',tag:"web",body:"Setup: `Browser -> nginx -> unix socket -> uWSGI -> Django`. nginx talks to uWSGI over a unix socket file. Then nginx logs:\n\n```\nconnect() to unix:/.../www.sock failed (13: Permission denied)\n```\n\n**The wrong fix: `chmod-socket = 777`.** Making the socket world-accessible does **not** help. When nginx has no `user` directive, its workers run as a low-privilege user (`nobody` / `www-data`) that cannot even traverse the directory to reach the socket. The file's permission bits are not the problem.\n\n**The fix: tell nginx which identity to run as**, in `nginx.conf`:\n\n```nginx\nuser jialinhuang staff;   # works\nuser root staff;          # works\nuser jialinhuang;         # FAILS - no group\n```\n\nThe group matters: without it the worker cannot reach the socket even at 777. So the rule:\n\n> Access to a unix socket is governed by **the user and group the process runs as**, not the socket file's `chmod`.\n\n## Why this is a unix-socket problem at all\n\nA unix socket is a **file** with owner/group/permissions \u2014 that is the only reason user/group matters here. A **TCP socket** (`127.0.0.1:8000`) is a network port, not a file, so it has no permissions and this error cannot happen. But switch to TCP for the right reason \u2014 reaching uWSGI across machines, or load-balancing several \u2014 not just to dodge a permission issue the `user` directive already fixes. (Unix socket also means same-machine IPC with no network overhead, so it is the better default when both run on one host.)"},{title:"AWS private connectivity: which service, and the usual confusions",tag:"aws",body:`AWS has a pile of ways to connect privately. Sorted by what they connect:

| service | connects | cross-region |
|---|---|---|
| **Direct Connect** | on-prem to AWS over a physical line | reaches any region's public services; private VPCs via a DX Gateway |
| **Site-to-Site VPN** | on-prem to a VPC over the internet (IPsec, encrypted) | - |
| **VPC Peering** | one VPC to one VPC | yes (inter-region peering) |
| **Transit Gateway** | many VPCs + on-prem, as a hub | yes (inter-region peering) |
| **Interface Endpoint** (PrivateLink) | your VPC to a service (most AWS services, or your own) via a private ENI | **yes**, since 2024 |
| **Gateway Endpoint** | your VPC to **S3 / DynamoDB only**, via the route table | no (same-region only) |

## When to reach for each

- **Direct Connect** \u2014 your own data center moving **large, steady volume** into AWS, wanting stable latency off the public internet. Pull a physical line.
- **Site-to-Site VPN** \u2014 connect a data center to a VPC **without a leased line**: a cheap encrypted tunnel, or a failover for Direct Connect.
- **Client VPN** \u2014 **individual people** (laptops) dialing into a VPC's private network.
- **VPC Peering** \u2014 just **two or three** VPCs need to talk (app VPC to shared-services VPC).
- **Transit Gateway** \u2014 **many** VPCs plus on-prem, when a mesh of peerings would be unmanageable: one central hub.
- **Interface Endpoint (PrivateLink)** \u2014 privately reach **one specific service** (another team's, a SaaS, or an AWS service like SQS) without the public internet and without wiring the whole VPC together.
- **Gateway Endpoint** \u2014 a **private subnet** needs S3/DynamoDB but you do not want to run a NAT Gateway just for that (cheaper, stays private).

## The confusions worth nailing

- **PrivateLink vs VPC Endpoint.** PrivateLink is the technology; an **Interface Endpoint** is its implementation (a private-IP ENI in your subnet). Same thing, two names.
- **Interface vs Gateway endpoint.** Interface = PrivateLink/ENI, costs money, reaches many services and works from on-prem or cross-region. Gateway = a route-table entry, **free**, but **only S3 and DynamoDB**, and **same-region, same-VPC only** (no on-prem, no peering, no TGW).
- **VPC Peering vs Transit Gateway.** Peering is one-to-one and **not transitive** (A-B and B-C does not give you A-C). Transit Gateway is a hub connecting many VPCs and on-prem at once.
- **VPN vs Direct Connect.** VPN is internet-based but encrypted; Direct Connect is a physical line for stable low latency. Use both together for private + encrypted.

## Facts that go stale (verified 2026-06)

- **Direct Connect is not "unencrypted."** It supports **MACsec** on 10/100/400 Gbps dedicated links, and you can still run an IPsec VPN over it.
- **Direct Connect has three VIF types**, not two: Public, Private, and **Transit** (to a Transit Gateway via a DX Gateway).
- **PrivateLink works cross-region now** (interface endpoints, since late 2024) \u2014 no longer same-region only.
- **S3 and DynamoDB support interface endpoints too**, not only gateway endpoints. Gateway endpoints stay S3/DynamoDB-only and same-region.`},{title:'AWS "Gateway" services, disambiguated',tag:"aws",body:`A dozen AWS things are called "Gateway." Grouped by what they do:

**VPC to internet**

| Gateway | What it does |
|---|---|
| **Internet Gateway** (IGW) | VPC to internet, **both directions** (makes a subnet public) |
| **NAT Gateway** | private subnet, IPv4 **outbound only** (source NAT; inbound blocked) |
| **Egress-Only Internet Gateway** | the **IPv6** version of NAT: outbound only |

**Connecting networks (hybrid / VPC-to-VPC)**

| Gateway | What it does |
|---|---|
| **Transit Gateway** (TGW) | regional **hub** for many VPCs + VPN + Direct Connect |
| **Virtual Private Gateway** (VGW) | the **AWS side** of a Site-to-Site VPN (one VPC) |
| **Customer Gateway** (CGW) | represents **your on-prem device** (the customer side of the VPN) |
| **Direct Connect Gateway** | connects a Direct Connect to **VPCs in any region** (via VGW or TGW) |
| **Local Gateway** (LGW) | **Outposts** to your on-prem network |
| **Carrier Gateway** | **Wavelength** (5G edge) to the telecom carrier network |

**Other**

| Gateway | What it does |
|---|---|
| **Gateway Endpoint** | route-table path to **S3 / DynamoDB only** (private, free, same-region) |
| **Gateway Load Balancer** (GWLB) | transparently routes traffic to **virtual appliances** (firewalls, IDS) |
| **API Gateway** | managed **API front door** (REST / HTTP / WebSocket) |
| **Storage Gateway** | on-prem app to AWS storage (**File / Volume / Tape** Gateway) |

The pair that trips people: **Customer Gateway** (your device) vs **Virtual Private Gateway** (AWS's side) \u2014 the two ends of one Site-to-Site VPN.`},{title:"DI lifetimes: Singleton vs Scoped vs Transient",tag:"concepts",body:"Every DI framework has the same three lifetimes; only the names change.\n\n- **Singleton** \u2014 one instance for the whole app.\n- **Scoped** \u2014 one instance per scope, usually **per HTTP request**.\n- **Transient** \u2014 a **new instance every time** it is injected.\n\n| lifetime | .NET / C# | NestJS | Spring | Angular |\n|---|---|---|---|---|\n| **Singleton** (one for the app) | `Singleton` | `DEFAULT` *(default)* | `singleton` *(default)* | `providedIn: 'root'` |\n| **Scoped** (per request) | `Scoped` | `REQUEST` | `request` | - *(no server requests)* |\n| **Transient** (new each time) | `Transient` | `TRANSIENT` | `prototype` | provided at component level |\n\n## Notes that bite\n\n- **The default differs.** NestJS and Spring default to **Singleton**; .NET makes you pick each time; Angular's usual `providedIn: 'root'` is also a singleton.\n- **Angular has no \"request\" scope** \u2014 it runs in the browser, there are no server requests. Its levels are `root` (singleton), `platform` (shared across apps on the page), or **component-level** (a fresh instance per component).\n- Angular's `providedIn: 'any'` and NgModule-based providing are **deprecated**; use `root` or `platform`.\n- **Singleton + mutable state is the classic trap**: one instance is shared across every request and user, so it must be thread-safe and can leak state between them."},{title:"Angular ViewEncapsulation\uFF1A\u9632\u51FA\u4E0D\u9632\u9032",tag:"web",body:`\u5169\u500B\u5143\u4EF6\u90FD\u5BEB \`.title { color: red }\`\uFF0CCSS \u53C8\u662F\u5168\u57DF\u7684\uFF0C\u8AB0\u84CB\u6389\u8AB0\uFF1F\u5143\u4EF6\u5316\u7684\u524D\u63D0\u662F\u6A23\u5F0F\u6709\u4F5C\u7528\u57DF\uFF0C\u700F\u89BD\u5668\u539F\u751F\u6C92\u7D66\uFF0CAngular \u7528 \`encapsulation\` \u7D66\u4E09\u6A94\u3002

## Emulated\uFF08\u9810\u8A2D\uFF09\uFF1A\u7DE8\u8B6F\u671F\u6232\u6CD5

\u5169\u500B\u52D5\u4F5C\u3002\u7B2C\u4E00\uFF0Ctemplate \u88E1\u6BCF\u500B\u5143\u7D20\u84CB\u4E0A\u9019\u500B\u5143\u4EF6\u5C08\u5C6C\u7684 attribute \u7AE0\uFF1A

\`\`\`html
<div class="title" _ngcontent-c42>
\`\`\`

\u7B2C\u4E8C\uFF0Cscss \u88E1\u6BCF\u689D selector \u7684\u6BCF\u4E00\u7BC0\u90FD\u88DC\u4E0A\u540C\u4E00\u500B\u7AE0\uFF1A

\`\`\`css
/* \u4F60\u5BEB */
#parent .title { color: red; }
/* \u7DE8\u8B6F\u5F8C */
#parent[_ngcontent-c42] .title[_ngcontent-c42] { color: red; }
\`\`\`

\u5169\u908A\u7AE0\u5C0D\u5F97\u4E0A\u624D\u751F\u6548\u3002parent \u5143\u4EF6\u7684\u5143\u7D20\u84CB\u7684\u662F parent \u81EA\u5DF1\u7684\u7AE0\uFF08\`_ngcontent-c17\`\uFF09\uFF0C\u4F60\u5728 child \u88E1\u5BEB \`#parent\` \u4E5F\u9078\u4E0D\u5230\u5B83\u3002ID\u3001class\u3001tag \u5168\u4E00\u6A23\uFF0C\u51FA\u4E0D\u53BB\u3002

\u53E3\u865F\uFF1A**\u9632\u51FA\u4E0D\u9632\u9032**\u3002\u51FA\uFF0C\u5143\u4EF6\u6A23\u5F0F\u6F0F\u4E0D\u51FA\u53BB\u3002\u9032\uFF0C\u5168\u57DF styles.scss \u7684 selector \u6C92\u6709\u7AE0\u7684\u9650\u5236\uFF0C\u7167\u6A23\u547D\u4E2D\u5143\u4EF6\u5167\u90E8\uFF0C\u5B57\u9AD4\u984F\u8272\u9019\u4E9B\u7E7C\u627F\u5C6C\u6027\u4E5F\u7167\u5E38\u5F80\u4E0B\u6D41\u3002\u9019\u662F\u6545\u610F\u7684\uFF1A\u4E3B\u984C\u548C reset \u672C\u4F86\u5C31\u8A72\u9032\u5F97\u4F86\u3002

## ::ng-deep\uFF1A\u81EA\u5DF1\u958B\u7684\u9580

\u898F\u5247\u4E00\u689D\uFF1Aselector \u88E1 \`::ng-deep\` \u4E4B\u5F8C\u7684\u90E8\u5206\uFF0C\u4E0D\u88DC\u7AE0\u3002

\`\`\`css
/* \u5B89\u5168\uFF1A\u9328\u5728\u81EA\u5DF1 host\uFF0C\u5F80\u4E0B\u4E0D\u770B\u7AE0 */
:host ::ng-deep .child-thing { }
/* \u7DE8\u8B6F\u5F8C \u2192 [_nghost-c42] .child-thing */

/* \u4E8B\u6545\uFF1A\u6574\u689D\u6C92\u6709\u7AE0\uFF0C\u7B49\u65BC\u5168\u57DF */
::ng-deep .child-thing { }
/* \u7DE8\u8B6F\u5F8C \u2192 .child-thing */
\`\`\`

\u524D\u8005\u80FD\u7A7F\u9032\u5B50\u5143\u4EF6\u6539\u6A23\u5F0F\uFF0C\u4F46\u88AB \`:host\` \u9650\u5236\u5728\u81EA\u5DF1\u7684\u5B50\u6A39\u88E1\u3002\u5F8C\u8005\u8DDF\u76F4\u63A5\u5BEB\u9032\u5168\u57DF stylesheet \u6C92\u5169\u6A23\uFF0C\u6574\u500B app \u540C\u540D class \u5168\u90E8\u547D\u4E2D\uFF0C\u662F Angular \u5C08\u6848\u6700\u5E38\u898B\u7684\u6A23\u5F0F\u6C61\u67D3\u6E90\u3002\u8A18\u6CD5\uFF1A\`::ng-deep\` \u958B\u9580\uFF0C\`:host\` \u6C7A\u5B9A\u9580\u958B\u5728\u54EA\u3002

## None\uFF1A\u81EA\u9858\u88F8\u5954

\u4E0D\u6539\u5BEB\u3001\u4E0D\u84CB\u7AE0\uFF0C\u5143\u4EF6\u7684 scss \u539F\u5C01\u4E0D\u52D5\u6CE8\u5165 \`<head>\` \u7576\u5168\u57DF\u6A23\u5F0F\u3002\u7528\u9014\uFF1A\u4E3B\u984C\u5143\u4EF6\uFF08\u672C\u4F86\u5C31\u8981\u5168\u57DF\uFF09\u3001\u8986\u5BEB\u7B2C\u4E09\u65B9\u5143\u4EF6\uFF08\u4EBA\u5BB6\u7684 DOM \u6C92\u6709\u4F60\u7684\u7AE0\uFF0CEmulated \u9078\u4E0D\u5230\uFF09\u3002

## ShadowDom\uFF1A\u771F\u7246

\u4E0D\u6A21\u64EC\u4E86\uFF0C\u76F4\u63A5 \`attachShadow()\`\uFF0Ctemplate \u6E32\u67D3\u9032 shadow root\u3002\u9694\u96E2\u8B8A\u6210 runtime \u7684\u771F\u908A\u754C\uFF0C\u800C\u4E14**\u96D9\u5411**\uFF1A\u51FA\u4E0D\u53BB\uFF0C\u4E5F\u9032\u4E0D\u4F86\u3002styles.scss \u5168\u90E8\u5931\u6548\uFF0C\u5143\u4EF6\u88F8\u5954\uFF1B\`::ng-deep\` \u7A7F\u4E0D\u904E\u771F\u7246\u3002\u7559\u4E0B\u7684\u901A\u9053\u53EA\u6709\u5169\u689D\uFF1ACSS custom properties\uFF08\`var(--accent)\` \u8D70\u7E7C\u627F\uFF0C\u7A7F\u5F97\u904E\uFF0C\u9019\u662F shadow DOM \u4E16\u754C\u7684\u4E3B\u984C\u5316\u6B63\u9053\uFF09\u548C \`::part()\`\uFF08\u5143\u4EF6\u4E3B\u52D5\u958B\u653E\u7684\u90E8\u4F4D\uFF09\u3002\u4E3B\u5834\u662F Angular Elements\uFF1A\u5143\u4EF6\u8981\u585E\u9032\u5225\u4EBA\u7684\u9801\u9762\uFF0C\u4F60\u7BA1\u4E0D\u4E86\u5BBF\u4E3B\u7684 CSS \u6709\u591A\u9AD2\uFF0C\u8981\u771F\u7246\u3002

## \u4E09\u6A94\u5C0D\u7167

| \u6A94\u4F4D | \u6A5F\u5236 | \u6211\u7684\u6A23\u5F0F\u51FA\u5F97\u53BB\uFF1F | \u5168\u57DF\u6A23\u5F0F\u9032\u5F97\u4F86\uFF1F |
|---|---|---|---|
| Emulated\uFF08\u9810\u8A2D\uFF09 | \u7DE8\u8B6F\u671F\u84CB\u7AE0 + selector \u6539\u5BEB | \u4E0D\u884C | \u53EF\u4EE5 |
| None | \u4EC0\u9EBC\u90FD\u4E0D\u505A | \u5168\u57DF\u751F\u6548 | \u53EF\u4EE5 |
| ShadowDom | \u539F\u751F shadow root | \u4E0D\u884C | \u4E0D\u884C\uFF08\u53EA\u5269 CSS \u8B8A\u6578\u548C ::part\uFF09 |`}];var E=(o,n)=>n.name,R=(o,n)=>n.title;function N(o,n){if(o&1){let e=f();a(0,"button",1),d("click",function(){let r=p(e).$implicit,h=c();return u(h.setTag(r.name))}),l(1),a(2,"span",2),l(3),s()()}if(o&2){let e=n.$implicit,t=c();S("active",t.activeTag===e.name),i(),P(" ",e.name," "),i(2),m(e.count)}}function G(o,n){if(o&1){let e=f();a(0,"div",7),d("click",function(){let r=p(e).$implicit,h=c();return u(h.open(r))}),a(1,"span",8),l(2),s()()}if(o&2){let e=n.$implicit;i(2),m(e.title)}}function L(o,n){if(o&1){let e=f();a(0,"div",9),d("click",function(r){p(e);let h=c();return u(h.onBackdropClick(r))}),a(1,"div",10)(2,"div",11)(3,"span",12),l(4),s(),a(5,"button",13),d("click",function(){p(e);let r=c();return u(r.close())}),l(6,"\xD7"),s()(),a(7,"div",14),y(8,"markdown",15),s()()()}if(o&2){let e=c();i(4),m(e.selectedCard.title),i(4),C("data",e.selectedCard.body)}}var b=class o{cards=A;activeTag="all";selectedCard=null;get tags(){let n=new Map;for(let e of this.cards)n.set(e.tag,(n.get(e.tag)??0)+1);return[...n.entries()].sort((e,t)=>t[1]-e[1]||e[0].localeCompare(t[0])).map(([e,t])=>({name:e,count:t}))}get filteredCards(){return this.activeTag==="all"?this.cards:this.cards.filter(n=>n.tag===this.activeTag)}setTag(n){this.activeTag=n}open(n){this.selectedCard=n}close(){this.selectedCard=null}onBackdropClick(n){n.target.classList.contains("modal-backdrop")&&this.close()}static \u0275fac=function(e){return new(e||o)};static \u0275cmp=g({type:o,selectors:[["app-misc"]],decls:11,vars:4,consts:[[1,"misc-filters"],[1,"filter-chip",3,"click"],[1,"chip-count"],[1,"filter-chip",3,"active"],[1,"misc-grid"],[1,"misc-card"],[1,"modal-backdrop"],[1,"misc-card",3,"click"],[1,"misc-title"],[1,"modal-backdrop",3,"click"],[1,"modal-box"],[1,"modal-header"],[1,"modal-title"],[1,"modal-close",3,"click"],[1,"modal-body","markdown-body"],[3,"data"]],template:function(e,t){e&1&&(a(0,"div",0)(1,"button",1),d("click",function(){return t.setTag("all")}),l(2," all "),a(3,"span",2),l(4),s()(),w(5,N,4,4,"button",3,E),s(),a(7,"div",4),w(8,G,3,1,"div",5,R),s(),k(10,L,9,2,"div",6)),e&2&&(i(),S("active",t.activeTag==="all"),i(3),m(t.cards.length),i(),v(t.tags),i(3),v(t.filteredCards),i(2),T(t.selectedCard?10:-1))},dependencies:[D],styles:[".misc-filters[_ngcontent-%COMP%]{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}.filter-chip[_ngcontent-%COMP%]{font-size:.875rem;border:1px solid var(--color-border);border-radius:999px;background:none;color:inherit;padding:4px 12px;cursor:pointer;transition:background .1s,color .1s,border-color .1s}.filter-chip[_ngcontent-%COMP%]:hover{background:var(--color-muted)}.filter-chip.active[_ngcontent-%COMP%]{background:var(--color-text);border-color:var(--color-text);color:#fff}.filter-chip.active[_ngcontent-%COMP%]:hover{background:var(--color-text)}.chip-count[_ngcontent-%COMP%]{opacity:.55;margin-left:2px}.misc-grid[_ngcontent-%COMP%]{display:flex;flex-wrap:wrap;gap:0}.misc-card[_ngcontent-%COMP%]{border:2.5px solid #1a1a1a;margin:-1.25px;padding:12px 14px;cursor:pointer;transition:background .1s,color .1s}.misc-card[_ngcontent-%COMP%]:hover{background:#1a1a1a;color:#f5f3f0}.misc-title[_ngcontent-%COMP%]{font-family:var(--font-code);font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em}.modal-backdrop[_ngcontent-%COMP%]{position:fixed;inset:0;background:#0006;display:flex;align-items:center;justify-content:center;z-index:1000}.modal-box[_ngcontent-%COMP%]{background:var(--color-bg, #fff);border:2.5px solid #1a1a1a;max-width:560px;width:90vw;max-height:80vh;overflow-y:auto;scrollbar-width:thin}.modal-header[_ngcontent-%COMP%]{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1.5px solid #1a1a1a}.modal-title[_ngcontent-%COMP%]{font-family:var(--font-code);font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em}.modal-close[_ngcontent-%COMP%]{background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--color-text-muted);line-height:1;padding:0 4px}.modal-close[_ngcontent-%COMP%]:hover{color:var(--color-text)}.modal-body[_ngcontent-%COMP%]{padding:20px;font-family:var(--font-code);font-size:.8rem;line-height:1.7;color:var(--color-text)}.modal-body[_ngcontent-%COMP%]     table{width:100%;border-collapse:collapse;margin:12px 0;font-size:.75rem}.modal-body[_ngcontent-%COMP%]     table th, .modal-body[_ngcontent-%COMP%]     table td{border:1.5px solid #1a1a1a;padding:6px 10px;text-align:left}.modal-body[_ngcontent-%COMP%]     table th{font-weight:700;background:var(--color-code-bg, #f6f8fa)}.modal-body[_ngcontent-%COMP%]     code{font-size:.8em;background:var(--color-code-bg, #f6f8fa);padding:2px 6px}.modal-body[_ngcontent-%COMP%]     pre{background:var(--color-code-bg, #f6f8fa);padding:12px;overflow-x:auto;font-size:.78rem;line-height:1.5}.modal-body[_ngcontent-%COMP%]     pre code{background:none;padding:0}.modal-body[_ngcontent-%COMP%]     p{margin:0 0 12px}.modal-body[_ngcontent-%COMP%]     p:last-child{margin-bottom:0}"]})};var O=class o{static \u0275fac=function(e){return new(e||o)};static \u0275cmp=g({type:o,selectors:[["app-misc-page"]],decls:3,vars:0,consts:[[1,"page-column"],["title","Misc","desc","Short discoveries. Click to read."]],template:function(e,t){e&1&&(a(0,"div",0),y(1,"app-page-header",1)(2,"app-misc"),s())},dependencies:[b,x],encapsulation:2})};export{O as MiscPageComponent};
