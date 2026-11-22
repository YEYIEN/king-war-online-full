import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const art=JSON.parse(readFileSync(new URL('../docs/v2-unit-art-manifest.json',import.meta.url),'utf8'));
test('12 unique V2 visual contract IDs cover all class/rank pairs without invented artworks',{timeout:2000},()=>{
 assert.equal(art.cards.length,12);
 assert.equal(new Set(art.cards.map(x=>x.id)).size,12);
 for(const type of ['步兵','刺客','魔法師','騎兵'])for(const rank of ['初級','中級','高級']){
  const card=art.cards.find(x=>x.type===type&&x.rank===rank);
  assert.ok(card,type+' '+rank);
  assert.equal(card.artworkStatus,'NOT_IN_REPOSITORY');
  assert.equal(card.approved,false);
  assert.ok(card.expectedArtPath.endsWith('.webp'));
 }
});
