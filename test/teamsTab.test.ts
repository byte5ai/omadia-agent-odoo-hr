/**
 * Teams-tab surface (byte5ai/omadia#1620): data-free shell, fail-closed
 * teams-sso data mount, manifest declaration — and the privacy rule that the
 * Teams absences view never carries the leave type (sick leave = health data).
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

import { TEAMS_MOUNT_PATH, UI_MOUNT_PATH } from '../src/plugin.js';
import { createHrTeamsDataRouter, createHrUiRouter } from '../src/routes/hrUiRouter.js';
import type { OdooExecutor } from '../src/routes/hrDataSource.js';
import { TEAMS_TAB_DATA_SEGMENT, createTeamsTabRouters } from '../src/routes/teamsTabRouter.js';

const LEAVE_TYPE_NAME = 'Krankheit (AU-Bescheinigung)';

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Fake Odoo: one sick leave running today, one sick leave next week. */
function fakeOdoo(calls: string[]): OdooExecutor {
  return {
    async execute(req) {
      calls.push(req.model);
      if (req.model === 'hr.leave') {
        return [
          {
            id: 1,
            employee_id: [7, 'Erika Mustermann'],
            holiday_status_id: [3, LEAVE_TYPE_NAME],
            date_from: `${isoDay(-1)} 07:00:00`,
            date_to: `${isoDay(1)} 16:00:00`,
            state: 'validate',
            department_id: [2, 'Engineering'],
            number_of_days: 3,
          },
          {
            id: 2,
            employee_id: [8, 'Max Beispiel'],
            holiday_status_id: [3, LEAVE_TYPE_NAME],
            date_from: `${isoDay(7)} 07:00:00`,
            date_to: `${isoDay(7)} 16:00:00`,
            state: 'validate',
            department_id: [2, 'Engineering'],
            number_of_days: 0.5,
          },
        ];
      }
      if (req.model === 'hr.employee') {
        return [
          { id: 7, name: 'Erika Mustermann', birthday: `1990-${isoDay(3).slice(5)}`, department_id: [2, 'Engineering'] },
        ];
      }
      throw new Error(`unexpected model ${req.model}`);
    },
  };
}

/** Every leave-type label and badge class the browser view can render. */
const LEAVE_TYPE_MARKERS = [
  /krank/i,
  /sick/i,
  /urlaub/i,
  /fortbildung/i,
  /elternzeit/i,
  /remote/i,
  /bg-(emerald|rose|indigo|violet|sky)-100/,
  /holiday_status/i,
];

describe('Teams tab surface', () => {
  const calls: string[] = [];
  let server: Server;
  let base: string;

  before(async () => {
    const opts = { odooClient: fakeOdoo(calls), log: () => {} };
    const teams = createTeamsTabRouters({
      mountPath: TEAMS_MOUNT_PATH,
      dataSegment: TEAMS_TAB_DATA_SEGMENT,
      pages: [
        { path: '/birthdays', title: 'Geburtstage' },
        { path: '/absences', title: 'Abwesenheiten' },
      ],
      dataRouter: createHrTeamsDataRouter(opts),
    });
    const app = express();
    // Stand-in for the kernel: `x-test-sso: 1` marks a verified Teams user.
    app.use(
      TEAMS_MOUNT_PATH + TEAMS_TAB_DATA_SEGMENT,
      (req, _res, next) => {
        if (req.header('x-test-sso') === '1') {
          (req as { teamsSsoUser?: unknown }).teamsSsoUser = { oid: 'o', tenantId: 't', appId: 'a' };
        }
        next();
      },
      teams.data,
    );
    app.use(TEAMS_MOUNT_PATH, teams.shell);
    app.use(UI_MOUNT_PATH, createHrUiRouter(opts));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  after(() => {
    server.close();
  });

  it('shell pages contain no data and never touch Odoo', async () => {
    for (const page of ['/birthdays', '/absences']) {
      const before = calls.length;
      const res = await fetch(`${base}${TEAMS_MOUNT_PATH}${page}`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.equal(calls.length, before, 'shell must not query Odoo');
      assert.doesNotMatch(body, /Erika|Max Beispiel|Engineering/);
      assert.match(body, /sha384-brW9AazbKR2dYw2DucGgWCCcmrm2oBFV4HQidyuyZRI\/TnAkmOOnTARSTdps3Hwt/);
      assert.ok(body.includes(`"${TEAMS_MOUNT_PATH}/_data${page}"`), 'shell fetches its data path');
    }
  });

  it('data router answers 401 without req.teamsSsoUser', async () => {
    for (const page of ['/birthdays', '/absences']) {
      const before = calls.length;
      const res = await fetch(`${base}${TEAMS_MOUNT_PATH}/_data${page}`);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { code: 'auth.teams_sso_required' });
      assert.equal(calls.length, before, 'no Odoo read before auth');
    }
  });

  it('Teams birthdays are served unchanged', async () => {
    const res = await fetch(`${base}${TEAMS_MOUNT_PATH}/_data/birthdays`, { headers: { 'x-test-sso': '1' } });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Erika Mustermann/);
  });

  it('Teams absences omit the leave type (no label, badge, attribute or raw name)', async () => {
    const res = await fetch(`${base}${TEAMS_MOUNT_PATH}/_data/absences`, { headers: { 'x-test-sso': '1' } });
    assert.equal(res.status, 200);
    const body = await res.text();
    // Person, from–to and duration are there …
    assert.match(body, /Erika Mustermann/);
    assert.match(body, /Max Beispiel/);
    const [y, m, d] = isoDay(7).split('-');
    assert.ok(body.includes(`${d}.${m}.${y}`), 'from–to date rendered');
    assert.match(body, /3 Tage/);
    assert.match(body, /0,5 Tage/);
    // … the leave type is not, in any form.
    assert.ok(!body.includes(LEAVE_TYPE_NAME));
    for (const marker of LEAVE_TYPE_MARKERS) assert.doesNotMatch(body, marker);
  });

  it('control: the session-gated browser view still shows the leave type', async () => {
    const res = await fetch(`${base}${UI_MOUNT_PATH}/absences`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Krank/);
    assert.match(body, /bg-rose-100/);
  });
});

describe('manifest', () => {
  const manifest = readFileSync(join(process.cwd(), 'manifest.yaml'), 'utf8');

  it('declares the Teams mount under permissions.public_paths', () => {
    const block = manifest.match(/^permissions:\n((?:[ #].*\n|\n)*)/m)?.[1] ?? '';
    const paths = block.match(/^ {2}public_paths:\n((?: {4}- .*\n)+)/m)?.[1] ?? '';
    assert.ok(paths.includes(`- "${TEAMS_MOUNT_PATH}"`), `public_paths must list ${TEAMS_MOUNT_PATH}`);
  });

  it('requires a core that knows auth: teams-sso (plugin-api >= 1.51.0)', () => {
    assert.match(manifest, /^ {2}core: ">=1\.51\.0 <2\.0"$/m);
  });
});
