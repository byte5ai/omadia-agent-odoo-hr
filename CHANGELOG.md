# Changelog

## 0.2.8

- Declare `odoo.agentToolkit.hr@^1` and `odoo.client@^1` under `requires:`
  (omadia#839). Both are resolved via `ctx.services.get` in activate() with an
  unconditional throw when absent, and `@omadia/integration-odoo` (>=0.2.1) now
  declares both under `provides:`, so the edges resolve and order the provider
  first. Retires the `@omadia/agent-odoo-hr` row in
  `STANDALONE_LEGACY_SERVICE_GRANTS_2026_08_20`.
