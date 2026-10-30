// Runs only in the PUBLIC binary-distribution repository. It never builds or
// executes the downloaded installer and has no store/source-repository access.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const metadata = JSON.parse(await readFile('release-payload.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('Invalid release version.');
const repository = process.env.GITHUB_REPOSITORY;
if (repository !== 'nawafonti123/hawk-public-pos') throw new Error('This workflow is restricted to the public installer repository.');
const tag = `v${metadata.version}`;
if (spawnSync('gh', ['release', 'view', tag, '--repo', repository], { stdio: 'ignore' }).status === 0) throw new Error('A published release is immutable. Bump the version instead of replacing it.');
const directory = join(tmpdir(), 'hawk-release-' + metadata.version);
await mkdir(directory, { recursive: true });
const expectedNames = new Set([`Hawk-POS-${metadata.version}-x64-setup.exe`, `Hawk-POS-${metadata.version}-x64-setup.exe.sig`, 'latest.json', 'SHA256SUMS']);
if (metadata.artifacts.length !== 4) throw new Error('Exactly four public release artifacts are required.');
const output = [];
for (const artifact of metadata.artifacts) {
  if (!expectedNames.delete(artifact.name) || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 536870912 || !Array.isArray(artifact.parts) || artifact.parts.length > 1024) throw new Error('Invalid artifact metadata.');
  const parts = [];
  for (const sha of artifact.parts) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid Git blob identifier.');
    const data = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/git/blobs/${sha}`], { encoding: 'utf8', maxBuffer: 2097152 }));
    if (data.encoding !== 'base64' || data.size > 700000) throw new Error('Invalid chunk.');
    const bytes = Buffer.from(data.content, 'base64');
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (actual !== sha) throw new Error('Git blob verification failed.');
    parts.push(bytes);
  }
  const bytes = Buffer.concat(parts);
  if (bytes.length !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Artifact SHA256 verification failed.');
  const destination = join(directory, artifact.name);
  await writeFile(destination, bytes); output.push(destination);
}
const latest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
if (latest.version !== metadata.version || latest.platforms['windows-x86_64'].url !== `https://github.com/${repository}/releases/download/${tag}/Hawk-POS-${metadata.version}-x64-setup.exe`) throw new Error('The signed update manifest points outside this release.');
const notes = join(directory, 'release-notes.md');
await writeFile(notes, 'Local-store preview: bundled PostgreSQL and .NET, local cash/accounting, version-bound signed updates.\n\nValidated on the development Windows host. A clean Windows VM, long disconnection soak, physical power faults, native peripherals and Windows Authenticode certification remain release gates. The separate status service has not been provisioned on the domain. Store databases and credentials are never uploaded.\n');
execFileSync('gh', ['release', 'create', tag, ...output, '--repo', repository, '--title', `HAWK POS ${metadata.version} — local-store preview`, '--notes-file', notes, '--latest'], { stdio: 'inherit' });
