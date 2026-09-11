import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {homedir} from 'node:os';
import { makeServer, DEFAULT_OUTPUT } from './server.ts';

// Load this operator's existing private credential on every restart. Never print it.
// Operator supplies HOTDATA_API_KEY through judge.env; no private host credential file is read.
const output = process.env.TRU_PLAN_OUTPUT ?? DEFAULT_OUTPUT;
const port = Number(process.env.TRU_PLAN_PORT ?? '7790');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a valid local port.');
await stat(resolve(output, 'public/talk.js'));
const server = makeServer({ storePath: resolve(output, 'data/checklist.json'), publicPath: resolve(output, 'public') });
server.listen(port, '127.0.0.1', () => { console.log(`TRU Synth plan http://127.0.0.1:${port}`); });
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
