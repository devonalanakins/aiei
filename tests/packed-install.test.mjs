import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// This checks byte equality between the selected checkout and a disposable installed
// package; it does not authenticate the author, checkout origin, or npm publisher.
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function mismatchedInstalledFiles(source, installed, files) {
  return files.filter(path => {
    const original=join(source,path), copy=join(installed,path);
    return !existsSync(original) || !existsSync(copy) ||
      !lstatSync(original).isFile() || !lstatSync(copy).isFile() ||
      digest(original)!==digest(copy);
  });
}

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
    const manifest=JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8'));
    const packedPaths=pack[0].files.map(file=>file.path);
    assert.deepEqual(
      packedPaths.sort(),
      ['package.json',...manifest.files].sort(),
      'real archive inventory must match the explicit reviewed source manifest'
    );
    const installedManifest=JSON.parse(readFileSync(join(installed,'package.json'),'utf8'));
    assert.equal(installedManifest.name,manifest.name);
    assert.equal(installedManifest.version,manifest.version);
    assert.equal(installedManifest.license,manifest.license);
    assert.deepEqual(mismatchedInstalledFiles(ROOT,installed,manifest.files),[],
      'every allowlisted source file must match the isolated installed file byte-for-byte');
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
      import { validateContract, validateReceipt, assess, EVIDENCE_VERSION, POLICY_VERSION, evaluateEvidenceGraph, parseEvidenceJSON, parseGitHubTarget } from 'aiei-engineering-integrity';
      const contract = JSON.parse(readFileSync(process.argv[2], 'utf8'));
      const receipt = JSON.parse(readFileSync(process.argv[3], 'utf8'));
      assert.equal(validateContract(contract).valid, true);
      assert.equal(validateReceipt(receipt).valid, true);
      assert.equal(validateContract({}).valid, false);
      assert.equal(assess(contract, receipt).ready_for_human_review, false);
      assert.equal(EVIDENCE_VERSION,'merit.evidence.v1');
      assert.equal(POLICY_VERSION,'merit.policy.v1');
      assert.equal(typeof evaluateEvidenceGraph,'function');
      assert.deepEqual(parseEvidenceJSON('{"test":true}'),{test:true});
      assert.deepEqual(parseGitHubTarget('example/repo',31),{repository:'example/repo',number:31});
    `);
    run(process.execPath, ['probe.mjs', contract, receipt]);
    assert.match(run(process.execPath, [join(installed,'bin','merit-evidence.mjs'),'--help']).stdout,
      /evidence packet|trusted-policy/);
    const badEvidence=join(consumer,'invalid-evidence.json');
    writeFileSync(badEvidence,'{');
    run(process.execPath,[join(installed,'bin','merit-evidence.mjs'),badEvidence,badEvidence],consumer,2);
    assert.ok(readFileSync(join(installed,'docs','CLAIM-EVIDENCE-V1.md'),'utf8').includes('merit.evidence.v1'));
    assert.equal(readFileSync(join(installed,'lib','evidence-graph.mjs'),'utf8').includes('merit.evidence.v1'),true);
    for(const path of ['lib/github-pilot.mjs','bin/merit-pilot.mjs','docs/GITHUB-ADVISORY-PILOT.md']) {
      assert.equal(existsSync(join(installed,path)),false,'review-only pilot leaked into package: '+path);
    }
    assert.match(readFileSync(join(installed, '.github/assets/readme-hero.svg'), 'utf8'), /<svg/);
    // Independent negative challenge: a changed installed file must be caught.
    // Only mutate the disposable consumer, never the reviewed checkout.
    const tampered='docs/ROADMAP.md', destination=join(installed,tampered);
    writeFileSync(destination,Buffer.concat([readFileSync(destination),Buffer.from('\nSYNTHETIC TAMPER TEST\n')]));
    assert.deepEqual(mismatchedInstalledFiles(ROOT,installed,manifest.files),[tampered]);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
