/**
 * Enforce bounded, valid client events before they reach game handlers.
 * This module does not modify any legal move, player choice or turn rule.
 * Rate limits are per socket and exist to bound repeated abusive requests.
 */
export const GAME_CLIENT_EVENTS = Object.freeze([
  "room:resume","room:leave","singleplayer:start","tutorial:start",
  "matchmaking:join","room:create","room:join","room:toggleReady",
  "game:rematch","room:updateSettings","room:addAI","room:removeAI",
  "game:start","game:lastStand","game:deploy","game:recall",
  "game:attackUnit","game:attackKing","game:castMagic","game:endTurn"
]);
const GAME_EVENT_SET = new Set(GAME_CLIENT_EVENTS);
const HIGH_COST_EVENTS = new Set(["room:resume","room:create","room:join",
  "matchmaking:join","singleplayer:start","tutorial:start"]);
const MAX_CLIENT_PAYLOAD_BYTES = 12 * 1024;
const OPTIONAL_OBJECT_EVENTS = new Set(["room:leave","room:toggleReady","game:rematch","room:addAI","room:removeAI","game:start","game:endTurn"]);

export function createSocketEventGuard({now=Date.now, onReject=()=>{}}={}) {
  const events=[];
  const joins=[];
  return function guard(packet, next) {
    const [event,payload,...args]=packet;
    if(!GAME_EVENT_SET.has(event)) return next();
    const reply=typeof args.at(-1)==="function"?args.at(-1):null;
    function reject(reason) {
      onReject(event,reason);
      if(reply) reply({ok:false,error:reason});
      // Never call the real handler on rejected payloads.
    }
    if(payload===undefined && !OPTIONAL_OBJECT_EVENTS.has(event)) return reject("缺少操作資料。");
    if(payload!==undefined && (payload===null || typeof payload!=="object" || Array.isArray(payload)))
      return reject("操作資料格式無效。");
    let bytes=0;
    try { bytes=Buffer.byteLength(JSON.stringify(payload??{}),"utf8"); }
    catch { return reject("操作資料格式無效。"); }
    if(bytes>MAX_CLIENT_PAYLOAD_BYTES) return reject("操作資料過大。");
    const timestamp=now();
    while(events.length && events[0]<=timestamp-10000) events.shift();
    if(events.length>=180) return reject("操作過於頻繁，請稍後再試。");
    events.push(timestamp);
    if(HIGH_COST_EVENTS.has(event)) {
      while(joins.length && joins[0]<=timestamp-60000) joins.shift();
      if(joins.length>=24) return reject("建立或加入房間過於頻繁，請稍後再試。");
      joins.push(timestamp);
    }
    next();
  };
}
