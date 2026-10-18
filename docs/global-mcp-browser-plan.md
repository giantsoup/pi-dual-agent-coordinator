# Global MCP tools and agent browser access

Status: proposed implementation plan, October 18, 2026. No application behavior or personal configuration changed. This plan covers the current working source on `main` at `8532d2d`, including the existing uncommitted model-picker work.

The intended result is that Agents A and B can discover and use your compatible global MCP tools, browse public sources, and test an approved local application through Playwright. Agent A retains read-only workspace access. Agent B retains workspace execution authority and local LM Studio inference. Both agents get usable browser controls.

## What the investigation established

- The installed launcher's MCP implementation matches the working build. Its loader resolved zero sources and zero servers for this workspace. Neither `~/.pi/agent/mcp.json` nor this workspace's `.mcp.json` exists.
- Your Codex global configuration contains three server definitions: two commands and one remote URL. The app currently imports none of them. Importing only stdio definitions would leave part of this inventory unsupported.
- [The loader](../src/mcp/config-loader.ts) understands Pi JSON, project JSON, and explicit JSON paths. It conflates configuration location with default server cwd. [The client pool](../src/mcp/client-pool.ts) and [doctor](../src/app/doctor.ts) require cwd to equal the workspace, reject HTTP/SSE, and permit only four environment overrides.
- [The runtime](../src/runtime/create-role-runtime.ts) supplies both agents with the built-in MCP extension while disabling executable global and project Pi resources. [Tool isolation](../src/security/isolation.ts) denies networking, real-home credentials, Keychain, and other-process inspection.
- There is no explicit Playwright integration in current app source or an installed `@playwright/mcp` package. `feature/browser-experience:ui/web/playwright.config.ts` runs archived portal UI tests. Its `src/app/browser.ts` opens a URL through the operating system. Neither establishes an agent-controlled browser.
- [The MCP result adapter](../src/mcp/direct-tools.ts) currently converts all content to text, including images. Browser screenshots need proper image and artifact handling.

The security restrictions were intentional. Commit `957ded3` introduced the credential broker and OS boundary. [The security model](security-model.md) specifically identifies local automation services as a possible way for sandboxed tools to obtain unrestricted host access. The new design must provide browser access without creating that route.

Recheck configuration shape without starting any server:

```sh
python3 docs/research/inspect-mcp-browser-readiness.py
```

This helper requires Python 3.11 or newer. It reports presence, counts, and field-shape flags, without printing server names, commands, arguments, URLs, headers, or environment values. It does not certify connectivity or security.

## Recommended design

Add a coordinator-owned MCP access service. It owns global configuration imports, per-role permissions, server connections, browser workers, and bounded results. The existing Pi extension remains the agent-facing adapter for tool discovery, direct tools, and the `mcp` proxy.

The service is trusted code. Imported server programs and browser pages remain outside that trust boundary. Launch server programs in separate OS-isolated workers. Keep A and B server sessions, browser state, and artifact namespaces separate. Do not load third-party server code into the trusted coordinator process.

Keep ordinary read, write, edit, and shell tools under their existing restrictions. Internet access comes through the managed browser or an approved MCP service. It does not require giving shell commands unrestricted networking.

### Operator and caller experience

The implementation adds an MCP status view to both terminal interfaces and extends `doctor`. It lists source, supported transport, readiness, role access, browser availability, and a safe reason when unavailable. Distinguish discovered, configured, authenticated, connected, and successfully exercised.

Proposed operator configuration selects global sources and browser scope once. Research navigation and normal test interactions then run within that scope without repeated prompts. Public research uses anonymous browser sessions. Local verification records exact application origins and whether disposable test-data mutations are allowed.

Proposed agent flow:

1. Search the policy-filtered MCP catalog and call a discovered documentation or research tool.
2. Open a public page with the browser when interactive navigation or page inspection is useful.
3. Open the configured local test app, inspect its accessibility snapshot, interact with it, and capture evidence.
4. Return source URLs, assertions, and artifact references with the result.

These operations are proposed interfaces, not commands that exist today.

### Module ownership and interface sketch

Use strict TypeScript, ESM `.js` imports, schema validation at external boundaries, and discriminated unions. Reuse the installed MCP SDK for protocol handling. The sketch below defines ownership, not compile-ready declarations. Parse the semantic IDs and paths into validated domain types before use.

```ts
type Role = "A" | "B";

type ServiceDefinition =
	| { kind: "stdio"; id: ServiceId; recipe: ApprovedLaunchRecipe }
	| { kind: "http"; id: ServiceId; endpoint: ApprovedEndpoint; auth: ServerAuth }
	| { kind: "unavailable"; id: ServiceId; reason: UnavailableReason };

type BrowserScope =
	| { kind: "public-research" }
	| { kind: "local-verification"; target: ApprovedTestTarget };

type AccessRequest =
	| { kind: "tool"; service: ServiceId; tool: ToolId; input: JsonObject }
	| { kind: "resource"; service: ServiceId; resource: ApprovedResource }
	| { kind: "prompt"; service: ServiceId; prompt: PromptId; input: JsonObject }
	| { kind: "browser"; session: BrowserHandle; action: BrowserAction };

interface RoleAccess {
	catalog(): Promise<VisibleCatalog>;
	openBrowser(scope: BrowserScope): Promise<BrowserHandle>;
	execute(request: AccessRequest, signal: AbortSignal): Promise<AccessResult>;
}

interface McpAccessService {
	bind(identity: RuntimeIdentity): RoleAccess;
	status(): AccessStatus;
	close(): Promise<void>;
}
```

`RuntimeIdentity` binds role, workspace, conversation, and runtime generation. Agent arguments cannot choose another role or supply a process, credential, profile path, destination override, or network grant. Closed or replaced runtime identities cannot make new calls.

Keep the implementation close to the existing modules:

- `src/mcp/global-sources.ts`, new: source-specific parsing, provenance, supported-format reporting, and normalized launch definitions.
- `src/mcp/access-service.ts`, new: role-bound access, worker and connection ownership, lifecycle, and dispatch. Adapt `client-pool.ts` as its internal MCP transport implementation.
- `src/mcp/policy.ts`: one policy authority for direct calls, proxy calls, connection/discovery, resources, prompts, and browser actions.
- `src/security/service-isolation.ts`, new: per-service worker profiles and enforced egress. Ordinary `ToolIsolation` retains its default policy.
- `src/mcp/browser-service.ts`, new: managed Playwright sessions, structured actions, target grants, and browser lifecycle.
- `src/mcp/results.ts`, new: bounded text, images, structured results, safe errors, and role-scoped artifacts. Use it in both direct and proxy adapters.
- Coordinator and role runtime: create the access service once, bind current identities, and revoke bindings during replacement, reset, cancellation, and shutdown.

Keep transport/authentication details internal. Migrate existing direct/proxy callers in the same implementation wave, then delete their old server-launch path. Do not retain two independent policies or launch mechanisms.

## Import global definitions without importing host authority

Support the actual inventory first: Pi JSON and Codex TOML, plus project and explicit JSON files. Parse TOML with a maintained parser rather than regular expressions. Add other clients only when their formats are present and understood. Preserve the user's original files.

Discovery proposes definitions. Execution uses a normalized, approved definition stored outside the writable workspace. Record source provenance and the effective non-secret configuration. Separate global and project namespaces so a repository cannot shadow a global server with the same name.

Later sources can change ordinary settings only within their trust level. Project files cannot grant networking, select credential references, change approved executables, broaden browser scope, or replace trusted global endpoints. Revalidate changed definitions and invalidate old grants and metadata. A cached tool annotation or saved conversation never grants access.

A newly discovered project definition cannot execute until an operator-approved normalized definition exists outside the workspace. Existing automatically launched project entries need this explicit migration. Changes to display settings may remain ordinary configuration; adding or replacing executable code is never an ordinary setting override.

Keep configuration base directory, executable resolution, and execution cwd separate. Default project-aware global servers to the selected workspace. Validate explicit fixed directories against the server's filesystem grant. A server that needs unrestricted home access gets an unavailable reason. Resolve known relative launch fields without interpreting arguments as shell code or guessing the meaning of arbitrary argument strings.

Pin server packages and browser versions in a trusted installation outside the writable workspace. Install before runtime. Do not depend on downloading `npx ...@latest` packages during agent work. Changed executable/package identities require revalidation.

Some global entries depend on host-injected APIs, native sessions, or proprietary client behavior. Copying their command or configuration may not reproduce them. Classify each current server as supported, needs an adapter, needs private authentication, or host-only. In particular, validate the existing Node REPL and computer-use entries individually. Managed Playwright is the required browser path even if the computer-use integration cannot be exported.

## Support transports and credentials deliberately

Deliver isolated stdio and exact-endpoint Streamable HTTP support. The existing remote documentation server belongs in the first functional milestone, subject to actual connection verification. Keep legacy SSE unavailable until an inventoried server requires it and its transport tests exist.

For HTTP, let the trusted access service own TLS, server-scoped authentication, response limits, timeouts, and per-role sessions. Reject redirects initially. Validate connection destinations, OAuth metadata URLs when applicable, and resolved addresses. Do not accept model-selected authentication endpoints or arbitrary headers.

Preserve the inference credential boundary. The OpenAI inference key is never an MCP credential and remains inaccessible to servers, browsers, both agents, shell tools, logs, and artifacts. B inference continues through LM Studio without a cloud fallback.

Store MCP credentials separately with references in configuration. Never serialize raw source authentication values into status, fingerprints, catalogs, prompts, caches, or telemetry. Private migration must happen outside agent-visible capture. Start with anonymous and server-scoped static-auth transports. Implement interactive OAuth only when the inventory requires it, using the SDK's supported flow, PKCE/state, correct audiences, token storage, refresh, and endpoint validation. Do not reuse a token intended for another service.

For stdio servers, preserve a cleared environment. Admit documented non-secret settings per server. If a server needs its own credential, prefer a destination-bound authentication adapter. A worker that must receive its own scoped token becomes trusted for that token and must have an explicit credential and destination grant. This does not authorize access to the inference key or other servers' credentials. Redaction cannot make a malicious credential holder safe.

Apply authorization to every path, including resources and prompts. Treat returned instructions and page text as untrusted content. Do not execute imported prompts or treat server-provided annotations as proof of safety.

## Make Playwright available to both agents

Use a pinned official Playwright MCP package behind the managed browser adapter. Prefer accessibility snapshots and locators. Support navigation, tabs, click, fill, keyboard input, waiting, screenshots, and structured assertions for both A and B.

Browser policy must be explicit. Official Playwright metadata marks navigation and several verification actions as non-read-only. Conversely, some storage inspection tools are marked read-only but can expose authentication. The existing generic A policy cannot serve as the browser policy.

Browser recipes are reachable only through the typed browser adapter. Do not also expose their raw tools, resources, or prompts through generic direct tools or `mcp call_tool`. Otherwise an agent could bypass the restricted action set through the old entry point.

Separate three kinds of authority:

- Browser-session changes, such as navigation or opening a tab, are available to both roles.
- Workspace file changes remain governed by the existing A/B split.
- Application-data mutations require the configured target scope. Both agents can submit forms and exercise disposable test data on an approved local app. An external authenticated account or production system is a separate scope, outside the initial anonymous-research and disposable-test profiles.

Use separate browser workers per role. Within each role, keep public research and local verification in separate ephemeral contexts. Bind contexts and handles to the current conversation and runtime. Launch lazily, limit tabs and memory, and release idle workers so browser processes do not compete unnecessarily with local inference.

For authenticated local verification, support private operator login in the dedicated test context or an origin-bound test-account credential reference resolved by the browser service. Keep that session ephemeral. The credential API never returns the password, raw cookies, or an exported storage-state file. Treat the application as trusted for its own test credential; a malicious application could reflect that credential into page content. Use disposable application test accounts rather than personal production sessions.

Default research to public HTTPS, with constrained requests and no imported account sessions. Start with GET/HEAD requests. Test public search and documentation sites against that restriction and report compatibility limits. A site requiring broader requests needs an explicit policy extension, not silent fallback. Navigation and GET requests can still cause side effects. Anonymous research is not a proof of semantic read-only behavior.

Allow exact local application origins and required test dependencies through a separate grant. Do not grant all of localhost. Block inference ports, credential brokers, CDP endpoints, OS automation services, cloud metadata, and other private services. A local application can itself be a deputy, so managed test servers must be restricted to the workspace and test data. Existing unsandboxed servers require a separate trust assessment before their origin is granted.

Keep arbitrary host code, raw browser protocol/CDP access, browser-side arbitrary evaluation, cookie/storage export, host browser profiles, extensions, clipboard, uploads, and automatic downloads disabled in the initial release. Use structured DOM queries and assertions for verification. Screenshots write to a broker-owned artifact directory, never an agent-supplied host path. Add bounded upload/download flows later only when a concrete test needs them.

Public network access must be enforceable outside page JavaScript and Playwright's origin filters. The browser and its descendants may reach only a controlled egress service. Enforce destinations at connection time, including DNS/IP resolution, redirects, frames, subresources, WebSockets, and alternate protocols. Block direct sockets and bypasses such as unproxied QUIC/WebRTC. Retain browser sandboxing. The ability to run Chromium under this boundary is a prototype gate, not an assumption.

Disable WebSockets and service workers initially. If local verification needs a development server's WebSocket channel, grant and test that exact destination separately. The browser cannot alter its proxy, routes, grants, or network enforcement through an exposed tool.

Provide public-web research through the browser and compatible research MCP tools. A separate raw internet-enabled shell is not needed for this outcome.

## Results, evidence, and lifecycle

Return text and supported images as typed Pi content. Do not stringify screenshot base64 into prompts. Preserve image evidence for vision-capable models. Give text-only local models accessibility snapshots, structured assertions, and artifact references; do not silently send their screenshots to a cloud model.

Store artifacts outside the workspace under role/conversation namespaces. Validate MIME, size, filenames, ownership, retention, and quotas. Persist safe references, not cookies, raw network headers, or browser profiles. Text redaction cannot guarantee that a screenshot contains no sensitive page content. Begin with anonymous pages and disposable test accounts, and test binary/image output boundaries explicitly.

Use separate MCP sessions and metadata namespaces for A and B. Remote servers may still share an external account or database; local session isolation does not undo external side effects. Serialize mutating calls where the server contract requires it, without sharing browser contexts.

Propagate the coordinator's abort signal and deadline through transports, browser actions, artifact writes, and workers. On cancellation, replacement, or conversation reset, revoke old handles, stop descendants, and prevent late output from attaching to another request. Cleanup is idempotent. Killing a request cannot roll back a completed remote mutation; report uncertain outcomes and never automatically retry a non-idempotent action.

## Implementation sequence and acceptance gates

1. **Prove the boundary.** In a separate trusted test installation, prototype a browser plus egress service with dummy secrets. Exercise actual Chromium descendants, filesystem/Keychain denial, direct-network denial, allowed public navigation, and one granted disposable localhost app. After Chromium starts, test UDP/QUIC, WebRTC, DNS, WebSockets, service workers, subprocesses, and direct loopback connections to inference and credential services. Every ungranted route must fail while the granted browser action succeeds. If macOS isolation cannot support this, evaluate a separate OS identity or isolated guest service. Do not enable an unrestricted fallback.
2. **Import and explain readiness.** Add normalized definitions, source parsers, namespace and trust rules, cwd handling, version pinning, and terminal/doctor status. Inventory every current global entry. Prove that project overrides, command changes, secret-bearing errors, malformed files, and cache entries cannot enlarge permissions or leak credentials.
3. **Route MCP calls through the service.** Migrate offline stdio, add exact-endpoint Streamable HTTP, and implement role-bound sessions and server-scoped authentication. Test real fixture-server calls through both direct and proxy tools, plus resources, prompts, pagination, cancellation, errors, malformed content, and image results. Prove that server A's token cannot reach server B, redirected hosts, unapproved OAuth discovery destinations, returned errors, catalogs, or model-visible content. Include explicit token-passthrough rejection. Reconcile protocol/SDK support with installed versions before changing dependencies.
4. **Deliver the browser for A and B.** Add explicit browser permissions, research/local profiles, context separation, locator actions, assertions, and evidence. Demonstrate A independently navigating and reviewing a local page, and B exercising a form against disposable data. Verify cross-role cookies, artifacts, and handles are inaccessible. Prove screenshot handling for a vision model and structured verification for a text-only model.
5. **Exercise hostile and lifecycle paths.** Extend the existing dummy-secret verifier to imported configs, network-enabled workers, redirects, DNS rebinding, private-address variants, control services, prompt injection, file URLs, local-app deputies, credential/error output, images, artifacts, concurrent sessions, parent death, cancellation, reset, and model/runtime replacement. Explicitly verify the cleared environment and denial of coordinator/provider-broker process inspection for every new worker class, including browser descendants. Today's verifier alone cannot prove new process boundaries. Existing shell restrictions must still pass. Fail closed if the egress service or OS boundary is unavailable.
6. **Verify the installed result and enable actual servers.** Run `npm run check`, `npm test`, `npm run build`, `npm run verify:isolation`, and `npm run verify:terminal`, plus a new repeatable MCP/browser integration verifier. Exercise the trusted runtime used by the launcher. For each inventoried server, record an actual A and B tool call or a precise blocker. Run one bounded public-source research task and one local verification task through each real Pi role. Mock provider tests and manual MCP calls alone do not prove agent use.

Implement in an isolated checkout and preserve the existing working changes. Establish the baseline before edits. Update the security model, architecture decisions, setup, examples, doctor, and both terminal interfaces together. Record the exact deployed runtime and verification limits. Leave the archived portal interface separate.

The current model-picker work is uncommitted. A new worktree starts from a commit and will not contain it automatically. Establish the intended implementation baseline explicitly and preserve that work before creating the checkout. Do not silently omit it or commit it as part of this feature.

Completion means both agents can use each supported approved global service, independently browse public sources, and verify the configured local app. The evidence must also show that neither can access the inference key or use the browser/MCP service to bypass workspace restrictions. List genuinely host-only integrations explicitly. Do not call the work complete while a current inventory item has an unexplained failure.

## Design comparison and remaining risks

Two independent sketches were compared: a coordinator-owned access service and direct isolated server launches with a browser-specific network companion. The access-service design is the base because it covers the existing remote HTTP inventory and keeps authorization and runtime replacement under one owner.

An independent cross-review scored the sketches 15/18 and 13/18 across inventory coverage, credential protection, usable A/B browsing, lifecycle ownership, repository fit, and proof feasibility. It selected the access service and identified Chromium descendant containment as the principal unproved boundary. The final plan incorporates its requested separation of discovery from trust, the typed browser-only entry point, and the limits of redaction and GET-only research.

Adopt the direct-launch sketch's per-worker isolation, browser egress feasibility gate, and initially restricted browser features. Do not adopt its blanket exclusion of all HTTP/authenticated servers, which would miss the user's actual inventory. Omit signed-manifest infrastructure initially; a private, non-workspace configuration plus pinned trusted installation is sufficient for this local app's current trust model.

The main implementation risks are Chromium's required OS services, host-specific global integrations, public sites that need broader request methods, and authenticated browser profiles. The first three receive explicit prototype or per-server verification gates. Authenticated personal browser profiles remain a later capability with a separate credential analysis. Arbitrary websites and third-party tools are not made harmless by this design.

## Sources and verification limits

Local evidence: current source and installed MCP build, `957ded3`, [architecture decisions](architecture-decisions.md), [security model](security-model.md), and the archived Playwright files named above. No matching ticket, chat, observability, or analytics MCP was available for historical rationale.

Primary documentation checked October 18, 2026:

- [Official Playwright MCP](https://github.com/microsoft/playwright-mcp) documents browser tools, profiles, isolated sessions, and tool annotations.
- [Playwright configuration](https://playwright.dev/mcp/configuration/options) warns that origin lists and secret substitution are convenience defenses, not security boundaries.
- [MCP security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) covers token audience separation, proxy risks, SSRF, DNS resolution, redirects, and local server compromise.

Planning verification: all 12 existing focused MCP tests passed during the preceding investigation. The inventory helper was run against the current configuration and dummy fixtures, including malformed input, without printing dummy credential values. No personal MCP server, networked agent browser, or new access-service implementation has been launched. The gates above remain implementation work.
