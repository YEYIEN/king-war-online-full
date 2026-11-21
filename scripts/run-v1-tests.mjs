import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const paths=readdirSync(resolve(root,'tests')).filter(p=>p.endsWith('.test.mjs')&&!p.startsWith('v2-')).sort().map(p=>resolve(root,'tests',p));
if(!paths.length)throw Error('No V1 regression tests found');
const result=spawnSync(process.execPath,['--test',...paths],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
