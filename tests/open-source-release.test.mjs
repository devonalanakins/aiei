import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, lstatSync, cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REQUIRED = Object.freeze([
  'LICENSE',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'bin/aiei.mjs',
  'bin/merit-evidence.mjs',
  'lib/index.mjs',
  'lib/validate.mjs',
  'lib/assess.mjs',
  'lib/github-evidence.mjs',
  'lib/evidence-graph.mjs',
  'docs/ARCHITECTURE.md',
  'docs/CLAIM-EVIDENCE-V1.md',
  'docs/GITHUB-EVIDENCE.md',
  'docs/LEARNING.md',
  'docs/OPEN-SOURCE.md',
  'docs/RELEASE-GATES.md',
  'docs/ROADMAP.md',
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

function isExplicitFilePath(path) {
  return typeof path === 'string' && /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(path) &&
    !path.split('/').some(part => part === '.' || part === '..');
}

function evaluate({ manifest, lock, licenseText, packedPaths, sourcePaths }) {
  const errors = [];
  if (manifest?.license !== 'Apache-2.0') errors.push('package.json must declare Apache-2.0');
  if (lock?.packages?.['']?.version !== manifest?.version || lock?.version !== manifest?.version) {
    errors.push('package-lock root version differs from package.json');
  }
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
  if (Array.isArray(manifest?.files) && new Set(manifest.files).size !== manifest.files.length) {
    errors.push('Duplicate package.json files entry');
  }
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    errors.push('package.json must explicitly identify distributable files');
  } else {
    for (const path of manifest.files) {
      if (!isExplicitFilePath(path) || !sourcePaths.includes(path)) {
        errors.push(`package.json files entry must name an existing regular file: ${String(path)}`);
      }
      if (!packedPaths.includes(path)) errors.push(`Listed distribution file was not packed: ${String(path)}`);
    }
  }
  for (const path of REQUIRED) {
    if (!packedPaths.includes(path)) errors.push(`Published package is missing ${path}`);
  }
  const allowed = new Set(['package.json', ...(Array.isArray(manifest?.files) ? manifest.files : [])]);
  for (const path of packedPaths) {
    if (!allowed.has(path)) errors.push(`Unlisted file entered the package: ${path}`);
    if (isPrivatePath(path)) errors.push(`Published package includes private-looking path: ${path}`);
  }
  return errors;
}

const validFixture = {
  manifest: {
    license: 'Apache-2.0',
    version: '0.3.1',
    files: [...REQUIRED],
  },
  lock: { version:'0.3.1', packages: { '': { license: 'Apache-2.0',version:'0.3.1' } } },
  licenseText: 'Apache License\nVersion 2.0, January 2004\nEND OF TERMS AND CONDITIONS',
  packedPaths: ['package.json', ...REQUIRED],
  sourcePaths: [...REQUIRED],
};

test('open-source publication metadata accepts a coherent package', () => {
  assert.deepEqual(evaluate(validFixture), []);
});

test('rejects missing, falsely declared, or inconsistent license material', () => {
  assert.match(evaluate({ ...validFixture, licenseText: '' }).join(' '), /LICENSE/);
  assert.match(evaluate({ ...validFixture, manifest: { ...validFixture.manifest, license: 'UNLICENSED' } }).join(' '), /Apache-2.0/);
  assert.match(evaluate({ ...validFixture, lock: { version:'0.3.1', packages: { '': { license: 'MIT', version:'0.3.1' } } } }).join(' '), /lock/);
  assert.match(evaluate({ ...validFixture, lock: { ...validFixture.lock, version:'0.3.0' } }).join(' '), /version/);
  assert.match(evaluate({ ...validFixture, manifest: { ...validFixture.manifest, files:[...REQUIRED,...REQUIRED.slice(0,1)] } }).join(' '), /Duplicate/);
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

test('requires explicit file entries and rejects unlisted package contents', () => {
  for (const path of ['docs', 'docs/**', '../outside.json', '/absolute.json', 'docs\\backup.json']) {
    const manifest = { ...validFixture.manifest, files: [...REQUIRED, path] };
    assert.match(evaluate({ ...validFixture, manifest }).join(' '), /existing regular file/);
  }
  assert.match(evaluate({ ...validFixture, packedPaths: [...REQUIRED, 'docs/internal-export.json'] }).join(' '), /Unlisted file/);
  const path = 'docs/additional-guide.md';
  const manifest = { ...validFixture.manifest, files: [...REQUIRED, path] };
  assert.match(evaluate({ ...validFixture, manifest, sourcePaths: [...REQUIRED, path] }).join(' '), /not packed/);
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
  const sourcePaths = (manifest.files ?? []).filter(path => isExplicitFilePath(path) &&
    existsSync(resolve(ROOT, path)) && lstatSync(resolve(ROOT, path)).isFile());
  assert.deepEqual(evaluate({ manifest, lock, licenseText, packedPaths, sourcePaths }), []);
});

test('packaging excludes unreviewed files added beside distributable source, docs and examples', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'aiei-pack-boundary-'));
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    for (const path of ['package.json', ...manifest.files]) {
      const destination = join(fixture, path);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(ROOT, path), destination, { recursive: true });
    }
    const unreviewed = [
      'bin/local-debug.mjs',
      'lib/session-cache.txt',
      'docs/internal-export.json',
      'examples/customer-records.csv',
      '.github/assets/unreviewed.svg',
    ];
    for (const path of unreviewed) {
      writeFileSync(join(fixture, path), 'SYNTHETIC PACKAGING FIXTURE ONLY\n');
    }
    const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline', '--silent'], {
      cwd: fixture, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, npm_config_update_notifier: 'false' },
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const packages = JSON.parse(result.stdout);
    assert.equal(packages.length, 1);
    const packedPaths = packages[0].files.map(file => file.path);
    assert.deepEqual(unreviewed.filter(path => packedPaths.includes(path)), [],
      'unreviewed adjacent files must never enter the package automatically');
    for (const path of REQUIRED) assert.ok(packedPaths.includes(path), `required file missing: ${path}`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('package never silently includes the experimental read-only GitHub pilot', () => {
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  for(const path of ['bin/merit-pilot.mjs','lib/github-pilot.mjs','docs/GITHUB-ADVISORY-PILOT.md']) {
    assert.equal(manifest.files.includes(path),false,'review-only pilot must remain checkout-only: '+path);
  }
  for(const path of ['lib/evidence-graph.mjs','bin/merit-evidence.mjs','docs/CLAIM-EVIDENCE-V1.md']) {
    assert.ok(manifest.files.includes(path),'new published API missing: '+path);
  }
});
