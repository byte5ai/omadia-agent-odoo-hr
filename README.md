<div align="center">

# @omadia/agent-odoo-hr

### Read-only Odoo HR tools for omadia — employees, departments, leave, contracts, excluding salaries.

An **Odoo HR** capability plugin (kind `tool`) for [omadia](https://github.com/byte5ai/omadia),
built on [`@omadia/integration-odoo`](https://github.com/byte5ai/omadia-integration-odoo).

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## How it works

A capability plugin of kind `tool` (spec 2042 §5.10): it owns no credentials
and no persona. `src/plugin.ts` takes the scope-locked HR toolkit that
`@omadia/integration-odoo` publishes as the `odoo.agentToolkit.hr` service and
registers each tool with `ctx.tools.register` (`src/registerTools.ts`); the
kernel offers them to the agents the operator granted this plugin to. The
knowledge that used to be the playbook skill (allowed models and fields, hard
red lines, query recipes) now sits in the tool descriptions
(`src/toolDocs.ts`) and in `playbook.when_to_use`. The former persona ships as
two inactive agent templates (English and German) in `manifest.yaml`; an
operator turns one into an agent in the Agent Builder.

Tools (both `side_effects: read`):

| Tool | Was | Does |
|------|-----|------|
| `odoo_hr_query_graph` | `query_graph` | pre-synced `hr.employee` / `hr.department` master data |
| `odoo_hr_execute` | `odoo_execute` | read-only `execute_kw` in the HR scope, red lines enforced server-side |

The old names were private to the sub-agent. As native tools they are
instance-wide and the accounting plugin has the same two, so each scope has its
own prefix. The plugin also serves the HR dashboards below. Needs omadia core
>= 1.76.0 (kind `tool`, `agent_templates`).

## UI routes and Teams tabs

| Path | Auth | Serves |
|------|------|--------|
| `/p/agent-odoo-hr/{birthdays,absences}` | `session` | browser view (full) |
| `/p/agent-odoo-hr/teams/{birthdays,absences}` | `public` | data-free shell: Teams SSO token → loads the data page |
| `/p/agent-odoo-hr/teams/_data/{birthdays,absences}` | `teams-sso` | Teams view (any tenant member) |

The Teams prefix is declared in `permissions.public_paths` and is only served
after the operator grants it (requires omadia core with plugin-api >= 1.51.0,
byte5ai/omadia#1620). Because every tenant member can open a Teams tab, the
Teams absences view **omits the leave type** (sick leave is health data).

## Build, typecheck

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build        # tsc
npm run package      # out/<id>-<version>.zip
npm test             # node:test (compiled to .test-build/)
```

`@omadia/plugin-api` and `@omadia/orchestrator` are **peer dependencies**,
provided by the omadia host at runtime. `@omadia/verifier` and
`@omadia/plugin-ui-helpers` are additionally linked as `file:` devDependencies
(imported at the value level, not just typed) so local typechecking and
builds are green standalone — see `paths` in `tsconfig.json`, which assumes a
sibling `odoo-bot` checkout.

## Manifest

See [`manifest.yaml`](manifest.yaml) for the full plugin manifest.

## License

MIT © byte5 GmbH — see [LICENSE](LICENSE).
