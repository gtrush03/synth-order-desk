import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {validateCompany} from '../src/company-workspace.ts';import {workspaceMap} from '../src/workspace-map.ts';import {previewScenario} from '../src/public-preview.ts';import {sampleProposal} from '../src/rehearsal-model.ts';
const company=JSON.parse(await readFile('fixtures/company.json','utf8'));
test('inventory reservations, holds and deadline eligibility must match the declared stock',()=>{
 const c=validateCompany(company);assert.equal(c.stockLots!.length,12);assert.equal(c.stock.available,100);
 const edited=structuredClone(c);edited.stockLots![0].reserved=0;assert.throws(()=>validateCompany(edited),/totals disagree/);
 const held=structuredClone(c);held.stockLots![6].status='ready';assert.throws(()=>validateCompany(held),/totals disagree/);
 const late=structuredClone(c);late.stockLots![0].readyBy='2026-09-30';assert.throws(()=>validateCompany(late),/totals disagree/);
 const map=workspaceMap({data:c,sha256:'test',memory:{schema:1,revision:2,notes:['Never split shipments.','Allow split shipments.'],approvals:[],updatedAt:new Date().toISOString()}});
 assert.equal(map.inventory.filter(x=>x.kind==='ready').reduce((sum,l)=>sum+l.available,0),100);assert.equal(map.inventory.filter(x=>x.kind==='held').reduce((sum,l)=>sum+l.available,0),68);assert.deepEqual(map.instructions.map(x=>x.active),[false,true]);
});
test('all three public experiments use the actual quote calculation and policy gate',async()=>{
 const library=JSON.parse(await readFile('public-data/scenarios.json','utf8'));assert.equal(library.scenarios.length,3);
 for(const s of library.scenarios){const c=validateCompany(s.company);for(const quantity of [60,140,200]){const plain=sampleProposal(quantity,200000,c);assert.deepEqual(previewScenario(c,quantity,2000,false),plain);const single=previewScenario(c,quantity,2000,true);assert.ok(!single.chosen||single.chosen.id!=='split');assert.ok(!single.chosen||(single.chosen.onTime&&single.chosen.withinBudget));}}
 assert.equal(previewScenario(company,150,1800).chosen?.totalCents,175000);assert.equal(previewScenario(company,140,1800).chosen?.totalCents,163000);
});
