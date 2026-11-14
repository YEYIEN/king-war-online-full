import test from "node:test";
import assert from "node:assert/strict";
import {listPublicAttackCandidates} from "../server/ai-legal-actions.js";

const unit=(id,type,tapped=false)=>({id,type,tapped,status:[]});
test("public attack enumeration respects guard and readiness across multiple opponents",()=>{
 const self=[unit("ready","騎兵"),unit("spent","步兵",true)];
 const opponents=[
  {id:"defended",hp:30,eliminated:false,field:[unit("guard","步兵"),unit("archer","弓兵")]},
  {id:"exposed",hp:9,eliminated:false,field:[unit("mage","法師")]},
  {id:"dead",hp:0,eliminated:true,field:[]}
 ];
 const actions=listPublicAttackCandidates(self,opponents);
 assert.deepEqual(actions.map(a=>[a.type,a.enemyId,a.defenderId]),[
  ["unit","defended","guard"],
  ["unit","defended","archer"],
  ["king","exposed",undefined],
  ["unit","exposed","mage"]
 ]);
 assert.deepEqual(listPublicAttackCandidates(self,opponents,{truce:true}),[]);
});
test("AI candidate enumeration cannot read hidden opponent cards",()=>{
 const opponent={
  id:"target",hp:18,eliminated:false,field:[],
  get hand(){throw Error("hidden hand accessed");},
  get magic(){throw Error("hidden magic accessed");},
  get resumeToken(){throw Error("private credential accessed");}
 };
 assert.deepEqual(listPublicAttackCandidates([unit("one","騎兵")],[opponent]),[
  {type:"king",enemyId:"target",attackerId:"one"}
 ]);
});
