<div align="center">

# @omadia/agent-odoo-hr

### Read-only Odoo HR sub-agent for omadia — employees, departments, leave, contracts, excluding salaries.

An **Odoo HR** agent plugin for [omadia](https://github.com/byte5ai/omadia),
built on [`@omadia/integration-odoo`](https://github.com/byte5ai/omadia-integration-odoo).

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## How it works

A sub-agent playbook (`skills/playbook.md` + `skills/runtime-note.md`) plus a
plugin entry point (`src/plugin.ts`) wrapping the shared Odoo integration's
HR surface — employees, departments, leave, contracts (salaries excluded by
design), a graph-lookup tool from `@omadia/verifier`, and a small admin UI
route (`src/routes/hrUiRouter.ts`) built with `@omadia/plugin-ui-helpers`.

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
