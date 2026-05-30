
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./style.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);

const ASSET_BASE = "/king-war-assets";

function cardImage(card) {
  if (!card?.name) return "";
  return `${ASSET_BASE}/cards/${card.name}_63x88mm_300dpi.png`;
}

function kingImage(king) {
  if (!king?.name) return "";
  return `${ASSET_BASE}/kings/${king.name}.png`;
}

function CardArt({ card, small = false }) {
  const src = cardImage(card);
  if (!src) return null;
  return <img className={small ? "cardArt small" : "cardArt"} src={src} alt={card.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}

function KingArt({ king }) {
  const src = kingImage(king);
  if (!src) return null;
  return <img className="kingArt" src={src} alt={king.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}


function App() {
  const socket = useMemo(() => io(SERVER_URL), []);
  const [name, setName] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [playerId, setPlayerId] = useState(null);
  const [room, setRoom] = useState(null);
  const [message, setMessage] = useState("");
  const [targetPlayerId, setTargetPlayerId] = useState("");
  const [attackerId, setAttackerId] = useState(null);
  const [magicPlan, setMagicPlan] = useState(null);

  React.useEffect(() => {
    socket.on("room:update", (next) => {
      setRoom(next);
      const firstEnemy = next.players.find(p => p.id !== playerId && !p.eliminated);
      if (!targetPlayerId && firstEnemy) setTargetPlayerId(firstEnemy.id);
    });
    return () => socket.off("room:update");
  }, [socket, playerId, targetPlayerId]);

  const emit = (event, data = {}) => socket.emit(event, data, (res) => res?.ok ? setMessage("") : setMessage(res?.error || "操作失敗"));
  const safeName = () => name.trim() || "玩家";

  function createRoom() {
    socket.emit("room:create", { name: safeName(), maxPlayers }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "建立失敗");
      setPlayerId(res.playerId); setRoom(res.room); setMessage("");
    });
  }
  function joinRoom() {
    socket.emit("room:join", { name: safeName(), code: roomCodeInput }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "加入失敗");
      setPlayerId(res.playerId); setRoom(res.room); setMessage("");
    });
  }

  if (!room) return <main className="page centered"><section className="card hero"><h1>國王戰爭 Online Full v1</h1><p>完整規則線上測試版。</p><label>暱稱 / 遊戲 ID</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="例如 Wayne" /><div className="twoCols"><section><h2>創建房間</h2><label>遊玩人數</label><select value={maxPlayers} onChange={e=>setMaxPlayers(Number(e.target.value))}>{[2,3,4,5].map(n=><option key={n} value={n}>{n} 人</option>)}</select><button onClick={createRoom}>創建房間</button></section><section><h2>加入房間</h2><label>房間代碼</label><input value={roomCodeInput} onChange={e=>setRoomCodeInput(e.target.value.toUpperCase())} placeholder="例如 KW1234" /><button onClick={joinRoom}>加入房間</button></section></div>{message && <p className="error">{message}</p>}</section></main>;

  const me = room.players.find(p => p.id === playerId);
  const isHost = room.hostId === playerId;
  const isMyTurn = room.currentPlayerId === playerId;
  const enemies = room.players.filter(p => p.id !== playerId && !p.eliminated);
  const targetPlayer = room.players.find(p => p.id === targetPlayerId) || enemies[0];

  if (room.status === "lobby") return <main className="page centered"><section className="card hero"><h1>房間 {room.roomCode}</h1><p>把房間代碼傳給朋友。</p><p>人數：{room.players.length} / {room.maxPlayers}</p><div className="playerList">{room.players.map(p=><div key={p.id} className="playerRow"><strong>{p.name}</strong><span>{p.isHost ? "房主" : "玩家"}｜{p.connected ? "在線" : "斷線"}</span></div>)}</div>{isHost ? <button onClick={()=>emit("game:start")}>開始遊戲</button> : <p>等待房主開始遊戲...</p>}{message && <p className="error">{message}</p>}</section></main>;

  function attackUnit(defenderId) {
    if (!attackerId || !targetPlayer) return setMessage("請先選擇攻擊者和目標玩家。");
    emit("game:attackUnit", { attackerId, targetPlayerId: targetPlayer.id, defenderId });
    setAttackerId(null);
  }
  function attackKing() {
    if (!attackerId || !targetPlayer) return setMessage("請先選擇攻擊者和目標玩家。");
    emit("game:attackKing", { attackerId, targetPlayerId: targetPlayer.id });
    setAttackerId(null);
  }
  function beginMagic(magic) { setMagicPlan({ magic, casterId: "", targetPlayerId: magic.target === "我方" ? playerId : (targetPlayer?.id || ""), targetUnitIds: [] }); }
  function chooseMagicTarget(unitId) {
    if (!magicPlan) return;
    const max = magicPlan.magic.maxTargets || 1;
    const has = magicPlan.targetUnitIds.includes(unitId);
    let ids = [...magicPlan.targetUnitIds];
    if (has) ids = ids.filter(id => id !== unitId);
    else if (max === 1) ids = [unitId];
    else if (ids.length < max) ids.push(unitId);
    setMagicPlan({ ...magicPlan, targetUnitIds: ids });
  }
  function castMagic() {
    if (!magicPlan.casterId) return setMessage("請先點選一名我方法師作為施法者。");
    emit("game:castMagic", { magicId: magicPlan.magic.id, casterId: magicPlan.casterId, targetPlayerId: magicPlan.targetPlayerId, targetUnitIds: magicPlan.targetUnitIds });
    setMagicPlan(null);
  }

  const magicTargetPlayer = room.players.find(p => p.id === magicPlan?.targetPlayerId);

  return <main className="page"><header className="topbar"><div><h1>國王戰爭 Online Full</h1><p>房間 {room.roomCode}｜{isMyTurn ? "輪到你" : "等待其他玩家"}</p></div><button disabled={!isMyTurn} onClick={()=>emit("game:endTurn")}>結束回合</button></header>{message && <p className="error">{message}</p>}
    <section className="players">{room.players.map(p=><article key={p.id} className={`playerCard ${p.id===room.currentPlayerId ? "active" : ""} ${p.eliminated ? "dead" : ""}`}><h2>{p.name}{p.id===playerId?"（你）":""}</h2><p>HP {p.hp}｜{p.eliminated?"出局":"存活"}</p>{p.king && <KingArt king={p.king} />}{p.king && <p><strong>{p.king.name}</strong>：{p.king.effectName}</p>}<p>手牌 {p.handCount}｜魔法 {p.magicCount}</p><h3>場上兵種</h3><div className="miniGrid">{p.field.map(c=><div key={c.id} className="miniCard"><CardArt card={c} small /><strong>{c.name}</strong><small>傷害{c.damage}｜{c.tapped?"已行動":"可行動"}</small>{c.status?.length>0 && <small className="status">{c.status.join("、")}</small>}</div>)}</div></article>)}</section>

    <section className="controlRow"><div className="card"><h2>目標玩家</h2><select value={targetPlayer?.id || ""} onChange={e=>setTargetPlayerId(e.target.value)}>{enemies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="card"><h2>目前操作</h2><p>攻擊者：{me?.field.find(u=>u.id===attackerId)?.name || "未選擇"}</p><button disabled={!isMyTurn || !attackerId} onClick={attackKing}>攻擊目標國王</button></div></section>

    <section className="board"><div className="card"><h2>{targetPlayer?.name || "敵方"} 場上</h2><div className="hand">{targetPlayer?.field.map(c=><button key={c.id} className={`gameCard ${magicPlan?.targetUnitIds.includes(c.id)?"selected":""}`} disabled={!isMyTurn} onClick={()=>magicPlan ? chooseMagicTarget(c.id) : attackUnit(c.id)}><CardArt card={c} /><strong>{c.name}</strong><span>傷害 {c.damage}｜剋 {c.counterTarget}</span>{c.status?.length>0 && <span className="status">{c.status.join("、")}</span>}</button>)}</div></div><div className="card"><h2>我方場上</h2><div className="hand">{me?.field.map(c=><div key={c.id} className="unitWrap"><button className={`gameCard ${attackerId===c.id || magicPlan?.casterId===c.id || magicPlan?.targetUnitIds.includes(c.id)?"selected":""}`} disabled={!isMyTurn} onClick={()=>{ if(magicPlan && !magicPlan.casterId && c.type==="法師") setMagicPlan({...magicPlan,casterId:c.id}); else if(magicPlan && magicPlan.magic.target==="我方") chooseMagicTarget(c.id); else setAttackerId(c.id); }}><CardArt card={c} /><strong>{c.name}</strong><span>傷害 {c.damage}｜剋 {c.counterTarget}</span>{c.status?.length>0 && <span className="status">{c.status.join("、")}</span>}</button>{me?.king?.name==="成吉思汗" && isMyTurn && <button className="smallBtn" onClick={()=>emit("game:recall",{unitId:c.id})}>撤回</button>}</div>)}</div></div></section>

    {magicPlan && <section className="card magicPanel"><h2>施放魔法：{magicPlan.magic.name}</h2><p>{magicPlan.magic.text}</p><p>施法者：{me?.field.find(u=>u.id===magicPlan.casterId)?.name || "請點選我方場上的法師"}</p><label>目標玩家</label><select value={magicPlan.targetPlayerId} onChange={e=>setMagicPlan({...magicPlan,targetPlayerId:e.target.value,targetUnitIds:[]})}>{(magicPlan.magic.target==="我方" ? [me] : enemies).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><p>{magicPlan.magic.name==="天殞術" ? "全場效果，不用選單一兵種。" : `已選目標：${magicPlan.targetUnitIds.length}/${magicPlan.magic.maxTargets}`}</p>{magicTargetPlayer?.field?.length>0 && magicPlan.magic.name!=="天殞術" && <div className="hand">{magicTargetPlayer.field.map(c=><button key={c.id} className={`gameCard ${magicPlan.targetUnitIds.includes(c.id)?"selected":""}`} onClick={()=>chooseMagicTarget(c.id)}><CardArt card={c} /><strong>{c.name}</strong></button>)}</div>}<button onClick={castMagic}>確認施放</button><button className="secondary" onClick={()=>setMagicPlan(null)}>取消</button></section>}

    <section className="myArea"><div className="card"><h2>你的兵種手牌</h2><div className="hand">{me?.hand.map(c=><button key={c.id} className="gameCard" disabled={!isMyTurn || !!magicPlan} onClick={()=>emit("game:deploy",{cardId:c.id})}><CardArt card={c} /><strong>{c.name}</strong><span>傷害 {c.damage}｜剋 {c.counterTarget}</span></button>)}</div></div><div className="card"><h2>你的魔法卡</h2><div className="hand">{me?.magic.map(c=><button key={c.id} className="gameCard magic" disabled={!isMyTurn} onClick={()=>beginMagic(c)}><CardArt card={c} /><strong>{c.name}</strong><span>{c.level}｜{c.target}</span><span>{c.text}</span></button>)}</div></div><div className="card"><h2>遊戲紀錄</h2><div className="log">{room.log.slice().reverse().map((line,i)=><div key={i}>{line}</div>)}</div></div></section>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
