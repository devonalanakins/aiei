import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('a real tarball installs offline and supports documented CLI and library use', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'aiei-packed-'));
  try {
    const consumer = join(sandbox, 'consumer');
    mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const userConfig = join(sandbox, 'npmrc');
    writeFileSync(userConfig, '');
    const env = {
      ...process.env,
      npm_config_cache: join(sandbox, 'cache'),
      npm_config_userconfig: userConfig,
      npm_config_offline: 'true',
      npm_config_update_notifier: 'false',
    };
    delete env.AIEI_GITHUB_TOKEN;
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;
    const run = (command, args, cwd = consumer, status = 0) => {
      const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, status, result.stderr || result.stdout);
      return result;
    };

    const pack = JSON.parse(run('npm', [
      'pack', '--json', '--ignore-scripts', '--offline', '--silent', '--pack-destination', sandbox,
    ], ROOT).stdout);
    assert.equal(pack.length, 1);
    const archive = join(sandbox, pack[0].filename);
    run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive]);
    const installed = join(consumer, 'node_modules', 'aiei-engineering-integrity');
    const cli = join(consumer, 'node_modules', '.bin', 'aiei');
    const contract = join(installed, 'examples', 'contract.json');
    const receipt = join(installed, 'examples', 'receipt.json');
    assert.match(run(process.execPath, [cli, '--help']).stdout, /offline/);

    for (const [kind, path] of [['contract', contract], ['receipt', receipt]]) {
      const output = JSON.parse(run(process.execPath, [cli, 'validate', kind, path, '--json']).stdout);
      assert.equal(output.valid, true);
      assert.equal(output.independently_verified, false);
    }
    const assessment = JSON.parse(run(process.execPath, [cli, 'assess', contract, receipt, '--json'], consumer, 1).stdout);
    assert.equal(assessment.valid, true);
    assert.equal(assessment.declared_release_decision, 'NO_GO');
    assert.equal(assessment.ready_for_human_review, false);
    assert.equal(assessment.independently_verified, false);
    assert.ok(assessment.blockers.length > 0);

    const invalid = join(consumer, 'invalid.json');
    writeFileSync(invalid, '{}');
    const rejected = JSON.parse(run(process.execPath, [cli, 'validate', 'contract', invalid, '--json'], consumer, 1).stdout);
    assert.equal(rejected.valid, false);
    writeFileSync(invalid, '{');
    run(process.execPath, [cli, 'validate', 'contract', invalid, '--json'], consumer, 2);

    // Bare-specifier import from outside the source tree exercises package exports
    // and transitive imports, rather than falling back to the checkout's modules.
    writeFileSync(join(consumer, 'probe.mjs'), `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { validateContract, validateReceipt, assess } from 'aiei-engineering-integrity';
      const contract = JSON.parse(readFileSync(process.argv[2], 'utf8'));
      const receipt = JSON.parse(readFileSync(process.argv[3], 'utf8'));
      assert.equal(validateContract(contract).valid, true);
      assert.equal(validateReceipt(receipt).valid, true);
      assert.equal(validateContract({}).valid, false);
      assert.equal(assess(contract, receipt).ready_for_human_review, false);
    `);
    run(process.execPath, ['probe.mjs', contract, receipt]);
    assert.match(readFileSync(join(installed, '.github/assets/readme-hero.svg'), 'utf8'), /<svg/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
