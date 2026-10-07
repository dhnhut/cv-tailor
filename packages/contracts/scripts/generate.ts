import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import * as z from 'zod';
import { contracts, DOCUMENTS_KEY_PREFIX } from '../src/index.ts';

// Resolve relative to this file, not the shell's current folder.
const outDir = new URL('../schemas/', import.meta.url);

// HealthResponse → health_response.json. Python module names come from file names.
const fileName = (id: string) => `${id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}.json`;

const { schemas } = z.toJSONSchema(contracts, {
  target: 'draft-2020-12',
  unrepresentable: 'throw',
  uri: fileName, // cross-contract $refs must point at the real file name
});

// Remove old files first, so a deleted or renamed contract leaves no stale file.
await mkdir(outDir, { recursive: true });
for (const file of await readdir(outDir)) {
  if (file.endsWith('.json')) await rm(new URL(file, outDir));
}

for (const [id, schema] of Object.entries(schemas)) {
  // title = the Python class name, so it always matches the TS export name.
  const output = { title: id, ...schema };
  await writeFile(new URL(fileName(id), outDir), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote schemas/${fileName(id)}`);
}

// Constants the OpenTofu code needs (S3-15, ADR-0013 §7). HCL reads this file with
// jsondecode(file(...)), so each constant is written in one place.
const infraOut = new URL('../../../infra/generated/', import.meta.url);
await mkdir(infraOut, { recursive: true });
const infraConstants = { documentsKeyPrefix: DOCUMENTS_KEY_PREFIX };
await writeFile(
  new URL('contracts.json', infraOut),
  `${JSON.stringify(infraConstants, null, 2)}\n`,
);
console.log('wrote infra/generated/contracts.json');
