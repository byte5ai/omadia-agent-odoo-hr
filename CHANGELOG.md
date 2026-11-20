# Changelog

## 0.4.0

- Capability plugin instead of a sub-agent (spec 2042 §5.10, ADR-0014,
  byte5ai/omadia#2053): `identity.kind` is now `tool` (no own credentials; it
  rides on `@omadia/integration-odoo`). The plugin id is unchanged.
- `activate` registers every tool of the `odoo.agentToolkit.hr` service with
  `ctx.tools.register` and returns `{ close }`; it no longer returns a
  `toolkit` for a sub-agent.
- **Tool names changed**: `query_graph` is now `odoo_hr_query_graph` and
  `odoo_execute` is now `odoo_hr_execute`. As native tools the names are
  instance-wide, and the accounting plugin has the same two names (it becomes
  `odoo_accounting_*`). References to the old names inside the descriptions
  are rewritten.
- The persona is gone: the `skills/` prompt partials (`playbook`,
  `runtime-note`) are removed. Allowed models and fields, the hard red lines,
  query recipes and the aggregation rules moved into the tool descriptions and
  `playbook.when_to_use`; the persona (including the JSON row convention for
  templated routines) is now two inactive `agent_templates` (`hr-assistant`,
  `hr-assistant-de`).
- `capabilities[].side_effects`: `read` for both tools (the toolkit only
  allows search, search_read, read, search_count, read_group, fields_get).
- Removed `llm:` preferences and `permissions.memory`. `description` is
  `en`/`de`. The ZIP no longer carries `skills/`.
- `compat.core` is `>=1.78.0 <2.0` (kind `tool`, `agent_templates`; also
  covers the Teams-tab `teams-sso` mode).
- Dashboards and Teams tabs are unchanged.
- Tests: `test/capabilityPlugin.test.ts`.
- No model access and no network of its own: the plugin makes no `fetch` and
  uses no SDK; all Odoo traffic runs in the integration (`odoo.client`).
- Publish only after the S3a kernel (byte5ai/omadia#2140) runs on Fly.

## 0.3.0

- **Teams tabs via kernel Teams SSO** (byte5ai/omadia#1620). Since omadia
  #1596/#1608 a default `auth:'session'` route answers 401 inside Teams (no
  omadia cookie). The pages now have two surfaces:
  - `/p/agent-odoo-hr/{birthdays,absences}` — browser, `auth: 'session'`
    (spelled out), full view, unchanged;
  - `/p/agent-odoo-hr/teams/{birthdays,absences}` — data-free shell
    (`auth: 'public'`) that loads teams-js 2.34.0 (SRI-pinned), gets a Teams
    SSO token and fetches
  - `/p/agent-odoo-hr/teams/_data/{birthdays,absences}` — one
    `auth: 'teams-sso'` router behind a fail-closed `req.teamsSsoUser` guard.
- `uiRoutes` descriptors now point at the shell (`/teams/<page>`), which is
  what channel-teams pins as the tab URL.
- **Privacy:** every tenant member can open the Teams tab, so the Teams
  absences view omits the leave type (sick leave is health data): person,
  department, from–to, duration, substitute — no label, no colour-coded badge,
  no attribute. Built through an allowlist projection that never reads the
  type. The session-gated browser view keeps the full view.
- Absences now also show the duration (`hr.leave.number_of_days`) when set.
- Manifest: `permissions.public_paths: ["/p/agent-odoo-hr/teams"]` (must be
  granted by the operator); `compat.core` raised to `>=1.51.0 <2.0`.
- Tests (`npm test`, node:test): shell is data-free, data mount 401s without
  a Teams user, Teams absences carry no leave type, manifest declarations.

## 0.2.8

- Declare `odoo.agentToolkit.hr@^1` and `odoo.client@^1` under `requires:`
  (omadia#839). Both are resolved via `ctx.services.get` in activate() with an
  unconditional throw when absent, and `@omadia/integration-odoo` (>=0.2.1) now
  declares both under `provides:`, so the edges resolve and order the provider
  first. Retires the `@omadia/agent-odoo-hr` row in
  `STANDALONE_LEGACY_SERVICE_GRANTS_2026_08_20`.
