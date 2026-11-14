import test from "node:test";
import assert from "node:assert/strict";
import {previewMagicFieldEffect,applyMagicFieldEffect} from "../server/magic-effects.js";
const make=(id,rank="初級")=>({id,type:"法師",rank,status:[],tapped:false,damage:1,counterTarget:"騎兵"});
test("magic field forecast agrees with real executor without mutating original",()=>{
 for(const spell of ["火球術","冰凍術","力量術","虛弱術","增強術","流星雨","毒藥瓶","燃血術","天殞術"]){
  const owner={field:[make("low"),make("mid","中級"),make("high","高級")],hand:[{secret:"private"}]};
  const before=JSON.stringify(owner);
  const forecast=previewMagicFieldEffect(spell,owner,spell==="天殞術"?[]:["low","mid"]);
  const live={field:owner.field.map(unit=>({...unit,status:[...unit.status]}))};
  const result=applyMagicFieldEffect(spell,live,spell==="天殞術"?[]:["low","mid"]);
  assert.equal(forecast.ok,true);
  assert.deepEqual(forecast.target.field,live.field,`effect mismatch: ${spell}`);
  assert.equal(forecast.destroyed,result.destroyed);
  assert.equal(JSON.stringify(owner),before);
  assert.equal(JSON.stringify(forecast.target).includes("secret"),false);
 }
});
test("magic previews do not stack freezes or bypass field validation",()=>{
 const owner={field:[make("u","中級")]};
 const once=previewMagicFieldEffect("冰凍術",owner,["u"]).target;
 const twice=previewMagicFieldEffect("冰凍術",once,["u"]).target;
 assert.deepEqual(once,twice);
 assert.equal(previewMagicFieldEffect("冰凍術",null,["u"]).ok,false);
 assert.equal(previewMagicFieldEffect("冰凍術",owner,"u").ok,false);
});
