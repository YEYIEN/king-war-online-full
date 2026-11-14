/**
 * The public game and the simulation benchmark must never silently share
 * upgraded-policy defaults: the benchmark control needs to stay stable.
 * Explicit research challenger flags override the simulation guard.
 */
export function shouldUseKingAwarePolicy({
  difficulty,kingName,playerCount,settings={},simulation=false,experimental=false
}={}){
  if(experimental)return true;
  if(simulation||difficulty!=="hard")return false;
  if(settings.kingAwareHardAI===false)return false;
  if(settings.kingAwareHardAI===true)return true;
  return playerCount===2&&kingName==="亞歷山大大帝";
}

export function shouldUseRationalConqueror({
  difficulty,playerCount,settings={},simulation=false,experimental=false
}={}){
  if(experimental)return difficulty==="conqueror";
  if(simulation)return false;
  return difficulty==="conqueror"&&playerCount===2&&settings.rationalConquerorDuel!==false;
}
