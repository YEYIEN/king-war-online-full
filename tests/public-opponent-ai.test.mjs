import test from "node:test";
import assert from "node:assert/strict";
import { publicOpponentForAI } from "../server/ai-strategies.js";

test("AI opponent projections discard hidden hands, spells, reconnect tokens and sockets",()=>{
 const opponent={
  id:"op",hp:18,king:{name:"路易十四"},eliminated:false,magicCount:2,
  get magic(){throw new Error("AI must not inspect hidden magic cards");},
  get hand(){throw new Error("AI must not inspect hidden unit cards");},
  get resumeToken(){throw new Error("AI must not inspect reconnect tokens");},
  get socketId(){throw new Error("AI must not inspect socket identity");},
  field:[{id:"guard",rank:"中級",type:"步兵",status:["整備"],tapped:false}]
 };
 const view=publicOpponentForAI(opponent);
 assert.deepEqual(Object.keys(view).sort(),["eliminated","field","hp","id","king","magicCount"].sort());
 assert.equal(view.magicCount,2);
 view.field[0].status.push("changed");
 assert.deepEqual(opponent.field[0].status,["整備"]);
});
