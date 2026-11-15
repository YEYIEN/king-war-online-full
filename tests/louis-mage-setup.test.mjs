import test from "node:test";
import assert from "node:assert/strict";
import { scoreTeachingDeployment } from "../server/ai-strategies.js";

test("Louis mage setup is opt-in and preserves default normal strategy", () => {
  const ai={king:{name:"路易十四"},field:[],magic:[],hp:30};
  const mage={type:"法師",rank:"初級"};
  const enemy={field:[]};
  const baseline=scoreTeachingDeployment(mage,ai,enemy,"normal",10);
  const experimental=scoreTeachingDeployment(mage,ai,enemy,"normal",10,{louisMageSetup:true});
  assert.equal(baseline,10);
  assert.equal(experimental,28);
  const other={...ai,king:{name:"秦始皇"}};
  assert.equal(scoreTeachingDeployment(mage,other,enemy,"normal",10,{louisMageSetup:true}),10);
  assert.equal(scoreTeachingDeployment(mage,ai,enemy,"hard",10,{louisMageSetup:true}),10);
});
