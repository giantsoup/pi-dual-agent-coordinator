# Security model

## Credential boundary

The coordinator, its OpenAI credential broker, and the local LM Studio service are trusted. Agent-generated
instructions, workspace contents, tool arguments, stdio MCP servers, and tool
subprocesses are untrusted. Both agent roles receive tools whose executable code
runs in a macOS Seatbelt sandbox, launched with `/usr/bin/sandbox-exec`. Kernel
policy, rather than command matching, limits their access.

The private native helper uses `SecItemAdd`, `SecItemUpdate`, and
`SecItemCopyMatching`. Entry uses `NSSecureTextField` and writes directly to
Keychain. Retrieval goes through a dedicated anonymous pipe on descriptor 3.
The helper never writes a credential to stdout or stderr and refuses a terminal
or regular file as its credential-return descriptor. Status and errors contain
no credential values. There is no public credential-export command.

The trusted broker holds the project key in memory. Pi receives a fresh random
broker capability in an asynchronous `ModelRuntime` with an in-memory credential store, never the project key. Its
built-in OpenAI Responses provider sends requests to the broker. The broker
replaces authentication, constructs its own headers, and forwards only
`POST https://api.openai.com/v1/responses` for Agent A's selected approved model.
Redirects are forbidden. Endpoint, proxy, TLS, and Node injection overrides fail
closed. Neither `auth.json` nor `models.json` is evaluated for authentication.

Agent B uses a separate broker that forwards only
`POST http://127.0.0.1:1234/v1/chat/completions` for its selected downloaded LM Studio
model. It never retrieves the OpenAI key. Its upstream bearer value is an inert
placeholder, and LM Studio must run without API authentication. Both brokers
require a fresh private capability, reject redirects, and limit request and
response sizes. Agent B has no cloud fallback. Tool processes retain their
network restrictions and cannot contact either broker or LM Studio directly.
Treat LM Studio and its loaded model as trusted inference software; do not attach
external execution integrations to this server for coordinator requests.

The broker discards upstream error bodies and response headers. Whole SSE lines
are redacted before returning to Pi, including credential strings split across
transport chunks. Registered secrets and their common encodings are redacted
before tool exposure, app telemetry output, subscriber notification, MCP metadata
persistence, and ledger writes. Redaction is an additional safeguard, not the
credential boundary. A key never belongs in prompts or repository content.

## Tool isolation

The sandbox denies operations by default. It grants reads for the specific
workspace, trusted installation, selected system runtime directories, and a
fresh scratch directory. Agent B may write inside its workspace. Agent A may
write only its disposable scratch directory. Normal Agent A reads, searches,
and listings remain available. Agent B retains Pi's read, write, edit, and bash
tools, including workspace test commands.

The policy denies access to the real home and Keychain directories, outside
credential files, other processes' information, Mach service lookup and task
privileges, IPC, signals to other processes, terminal devices, and network
access. Subprocesses inherit the kernel restrictions, including nested shells,
native credential-store calls, and attempts to launch a weaker sandbox.
Symlinks, traversal, absolute paths, and hardlinks do not grant extra access.
Startup probes require both a running sandboxed Node process and an actual
permission denial for an existing protected file. Failure never falls back to
local execution.

Tool processes receive a fixed environment with a disposable HOME and TMPDIR.
They do not inherit the coordinator environment. MCP stdio launch additionally
uses `env -i` because the installed MCP transport merges a default inherited
environment. Configured overrides are limited to PATH, LANG, LC_ALL, and TZ.
No OpenAI key is supplied in tool environments, arguments, input, or results.

Workspace tools cannot access network services, including local automation
servers that could act as an unsandboxed deputy. Network-dependent test commands
and stdio MCP servers that require networking will fail under this policy.
HTTP and SSE MCP peers are rejected because this app cannot verify their local
execution boundary. Sandboxed stdio MCP discovery, direct tools, proxy tools,
resources, prompts, caching, and role policy remain supported. A server's
`readOnlyHint` cannot bypass Agent A's filesystem restrictions. Read-only hints
are still assertions by the server about external side effects, not proofs.

## Trusted code and runtime replacement

A writable workspace cannot contain the trusted installation, its dependencies,
or its native helper. It also cannot include `~/.pi` or `~/Library`. The
`secure:install` command creates a separate runtime snapshot. Each tool launch
uses that snapshot, and agents cannot modify it through their sandbox. The Node
runtime and system toolchain are part of the trusted installation assumptions.
Do not manually run agent-modified app code with credentials afterward.

Global and project Pi extensions, packages, skills, prompt templates, themes,
workspace/global custom model definitions, executable auth references, and shell startup files
are not loaded in the trusted runtime. Resource discovery occurs in a fresh
empty trusted directory. Workspace `AGENTS.md` is read as text through the
isolated read tool, so a symlink to a protected credential cannot turn the
resource loader into a credential reader. Coordinator-authored role prompts and
the built-in MCP extension are the only executable extensions.
The trusted metadata catalog filters Pi 1.3.0's bundled OpenAI descriptors by the
original approved IDs, including GPT-6.1 Sol, GPT-5.6 Terra, and GPT-6 Luna.
Picker enumeration constructs no auth runtime and makes no catalog requests. B's downloaded LLM keys
and capabilities are validated from the fixed loopback LM Studio inventory.
Local descriptors use a 65,536-token context and API thinking off. The broker
validates the selected logical model and resolves its ready instance before each
request. This does not accept endpoint or model data from files.
High reasoning is checked in the actual installed provider's serialized request;
the no-tools live smoke uses the saved Agent A reasoning level and a 1,024-token
cap that includes reasoning.

Pi 1.3.0's high-level session factory uses `tools` for name selection. Supplying
executable tools there does not isolate execution.
This app uses Pi's public `AgentSession` constructor with `baseToolsOverride`.
The entire tool registry contains only sandboxed role tools and the trusted MCP
adapter. Explicit allowlists, `usesDefaultTools:false`, and exclusions for native
`mcp__*`, `codemode`, and `tool_search` prevent persisted tool activation from
expanding permissions. External MCP schemas and arguments are validated before
execution, including proxy calls. The same construction runs on each coordinator-owned replacement.
Session switching is limited to that role's private session directory and cannot
change its workspace. Coordinator state must remain outside the workspace.

Agent A plans and reviews. Agent B executes. The coordinator alone can deliver
validated handoffs, replace runtimes, and persist workflow decisions. Machine
blocks affect workflow state only at stable `turn_end` boundaries. Rendering
never triggers transitions. Persistence and session subscriptions remain
coordinator-owned.

## Verification and failure policy

`npm run verify:isolation` builds the actual worker and native helper, then runs
`dist/src/security/verify-isolation.js` and the focused security tests. The
verifier uses fresh dummy secrets and a temporary Keychain account. It checks
both roles' actual tools, permitted operations, protected paths, environment
inheritance, subprocesses, process inspection, Keychain commands, nested
sandboxes, MCP launches, direct and proxy tools exposed by Pi, project extension
suppression, session replacement, endpoint rejection, startup failure, invalid
credentials, model-visible results, logs, sessions, caches, and ledger files.
It reports assertion counts, not secret values, and deletes its fixtures.
The locked-store error case uses an injected failing backend; the verifier never
locks the operator's login Keychain. Native missing-store and actual unlocked
Keychain operations are tested separately.

Setup requires successful dummy verification before real entry. Doctor checks
both role sandboxes, credential retrieval status, legacy auth, model selection,
and MCP compatibility. Doctor does not make an inference request or certify the
full suite. `smoke:api` performs the separately bounded, no-tools live Pi request.
No live request or unavailable isolation means Step 0 remains incomplete.

## Trust limits

This boundary protects credentials from agent-controlled tools and repository
instructions. It does not protect against a compromised coordinator, broker,
native helper, installed Pi/OpenAI dependencies, Node runtime, OS sandbox or
kernel, privileged administrator, or other unsandboxed software running under
the operator's account. It does not promise memory zeroization in JavaScript,
protection from swap or host crash diagnostics, or isolation from host debugging
and screen-capture software. Operator entry must occur outside recording and
agent capture. Sandbox workers cannot read broker memory, dump its environment,
or signal/debug it under the tested policy.

Workspace files are intentionally available to tools. Do not place credentials
there. The sandbox is not a general confidential-workspace guarantee, a resource
usage quota, or a guarantee that malicious tools cannot damage Agent B's allowed
workspace. External MCP side effects remain subject to the server's own policy.
Long-lived background descendants may retain their sandbox until they exit.

Seatbelt profiles and `sandbox-exec` are macOS-specific system interfaces that
can change. Verification must run on each deployment host and after OS, Pi,
Node, helper, or policy updates. Other operating systems fail closed. Keychain
availability depends on the current login session and macOS access decisions.
There is no plaintext, environment-key, subscription, or unrestricted fallback.

## Terminal cancellation and configuration

Idle-only model controls use the secure Pi registry and the same runtime factory
as startup. Agent A retrieves authentication through the trusted broker; Agent B
uses only its local broker. Both preserve role isolation. Arbitrary endpoints, project extensions, and
plaintext authentication remain disabled. Session history and restoration stay
inside the role's private session directory. Saved defaults contain no credentials.

LM Studio inventory, load and unload run only in the trusted application process
against `127.0.0.1:1234/api/v1/models`. These management operations are absent from
agent tools and the inference broker, and receive no OpenAI credential. Switching
waits for local readiness before committing the runtime and saved defaults.
Cancellation waits for pending server operations to settle and restores the old
model; failed restoration blocks new work until B is configured successfully.

Cancellation aborts Pi compaction, branch summaries, and agent work, then drains the owned prompt and runtime cleanup. Queued preflight cannot start a provider request after cancellation.
Sandboxed tool workers kill their process group on abort. MCP tool requests
receive the abort signal, but remote side effects cannot be rolled back.
Cancellation and timeout preserve changes already completed in the workspace.
The coordinator blocks later automatic stages and records a terminal outcome.
No browser restoration or automatic workflow continuation is introduced.

## Pi 1.3 runtime confinement

`ModelRuntime.create()` uses an in-memory credential store, `modelsPath:null`,
`refreshOnCreate:false`, and `allowModelNetwork:false`. The app replaces every
non-selected provider with an empty catalog and disabled auth adapter. The selected
provider resolves only its private broker capability. Registration refreshes are
held until initialization finishes. Every later refresh, including SDK reload,
forces `allowNetwork:false` and the selected provider. This restriction is required
because the creation flag alone does not control later refresh calls.

Settings explicitly disable cache warming, install telemetry, and analytics. The
direct constructor receives no cache warmer and no native MCP, codemode, or tool
search extension. The optional codemode setting is omitted because its schema has
no off value. Broker request validation still pins endpoint and model, independently
of catalog and credential policy. Concurrent sessions and replacements use
separate runtime instances and broker capabilities.

The awaited prompt and `waitForIdle()` cover outer `agent_settled`, compaction, and
recovery. Disposal aborts and drains the managed session before releasing the
broker. Low-level awaited turn listeners still pause B before its next request.
