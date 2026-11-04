import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REQUIRED = Object.freeze([
  'LICENSE',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'bin/aiei.mjs',
  'lib/index.mjs',
  'docs/OPEN-SOURCE.md',
  'examples/contract.json',
  'examples/receipt.json',
  '.github/assets/readme-hero.svg',
]);

function isPrivatePath(path) {
  return path.split('/').some(part =>
    part === '.env' || (part.startsWith('.env.') && part !== '.env.example') ||
    part === '.private' || part === 'node_modules' ||
    /\.(?:pem|key|p12|sqlite|sqlite3)$/i.test(part) ||
    /^id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/.test(part));
}

function evaluate({ manifest, lock, licenseText, packedPaths, sourcePaths }) {
  const errors = [];
  if (manifest?.license !== 'Apache-2.0') errors.push('package.json must declare Apache-2.0');
  if (lock?.packages?.['']?.license !== manifest?.license) {
    errors.push('package-lock root license differs from package.json');
  }
  if (typeof licenseText !== 'string' ||
      !licenseText.includes('Apache License') ||
      !licenseText.includes('Version 2.0, January 2004') ||
      !licenseText.includes('END OF TERMS AND CONDITIONS')) {
    errors.push('Repository LICENSE does not contain the expected Apache-2.0 terms');
  }
  if (manifest?.private === true) errors.push('package is marked private');
  for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (Object.keys(manifest?.[kind] ?? {}).length) {
      errors.push(`Runtime dependency-free claim requires review: ${kind} declared`);
    }
  }
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    errors.push('package.json must explicitly identify distributable files');
  } else {
    for (const path of manifest.files) {
      if (typeof path !== 'string' || !sourcePaths.includes(path)) {
        errors.push(`package.json files entry missing from repository: ${String(path)}`);
      }
    }
  }
  for (const path of REQUIRED) {
    if (!packedPaths.includes(path)) errors.push(`Published package is missing ${path}`);
  }
  for (const path of packedPaths) {
    if (isPrivatePath(path)) errors.push(`Published package includes private-looking path: ${path}`);
  }
  return errors;
}

const validFixture = {
  manifest: {
    license: 'Apache-2.0',
    files: ['bin', 'lib', 'docs', 'LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md'],
  },
  lock: { packages: { '': { license: 'Apache-2.0' } } },
  licenseText: 'Apache License\nVersion 2.0, January 2004\nEND OF TERMS AND CONDITIONS',
  packedPaths: [...REQUIRED],
  sourcePaths: ['bin', 'lib', 'docs', 'LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md'],
};

test('open-source publication metadata accepts a coherent package', () => {
  assert.deepEqual(evaluate(validFixture), []);
});

test('rejects missing, falsely declared, or inconsistent license material', () => {
  assert.match(evaluate({ ...validFixture, licenseText: '' }).join(' '), /LICENSE/);
  assert.match(evaluate({ ...validFixture, manifest: { ...validFixture.manifest, license: 'UNLICENSED' } }).join(' '), /Apache-2.0/);
  assert.match(evaluate({ ...validFixture, lock: { packages: { '': { license: 'MIT' } } } }).join(' '), /lock/);
});

test('rejects phantom manifest entries and incomplete distributable packages', () => {
  assert.match(evaluate({ ...validFixture, manifest: { ...validFixture.manifest, files: [...validFixture.manifest.files, 'schemas'] } }).join(' '), /schemas/);
  assert.match(evaluate({ ...validFixture, packedPaths: ['LICENSE'] }).join(' '), /bin\/aiei.mjs/);
  for (const path of ['examples/contract.json', 'examples/receipt.json', '.github/assets/readme-hero.svg']) {
    assert.ok(evaluate({ ...validFixture, packedPaths: REQUIRED.filter(entry => entry !== path) })
      .includes(`Published package is missing ${path}`));
  }
});

test('rejects accidental private files and unnoticed runtime dependencies', () => {
  assert.match(evaluate({ ...validFixture, packedPaths: [...REQUIRED, '.env.production'] }).join(' '), /private-looking/);
  assert.match(evaluate({ ...validFixture, packedPaths: [...REQUIRED, 'secrets/token.pem'] }).join(' '), /private-looking/);
  assert.match(evaluate({ ...validFixture, manifest: { ...validFixture.manifest, dependencies: { 'opaque-agent': '1.0.0' } } }).join(' '), /dependency-free/);
});

test('the actual source can be packaged with the expected open-source materials', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const licenseText = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--silent'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packages = JSON.parse(result.stdout);
  assert.equal(packages.length, 1, 'exactly one package must be staged');
  const packedPaths = packages[0].files.map(file => file.path);
  const sourcePaths = (manifest.files ?? []).filter(path => existsSync(resolve(ROOT, path)));
  assert.deepEqual(evaluate({ manifest, lock, licenseText, packedPaths, sourcePaths }), []);
});
