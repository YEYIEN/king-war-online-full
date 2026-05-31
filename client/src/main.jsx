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

function unitEffectText(card) {
  if (!card || card.kind !== "unit") return "";
  if (card.type === "步兵") return "守衛：防守方場上仍有步兵時，敵人不能直接攻擊國王。";
  if (card.type === "弓兵") return "遠射：攻擊低階敵人時，第一次可再攻擊一次；攻擊同階或高階敵人時不死亡，攻擊高階敵人則階級-1到下回合。";
  if (card.type === "法師") return "施法：回合開始時依場上法師數抽魔法卡。使用魔法視為一次攻擊。剛部署時不能使用同級魔法。";
  if (card.type === "騎兵") return "突擊：剛部署的回合即可攻擊；但高級騎兵仍須整備一回合。";
  return "";
}

function unitStatusText(card) {
  if (!card) return "";
  if (card.status?.includes("整備")) return "整備中";
  if (card.status?.includes("不能攻擊")) return "不能攻擊";
  if (card.tapped) return "已行動";
  if (card.justDeployed && card.type !== "騎兵") return "剛部署";
  return "可行動";
}

function actionHint({ room, me, isMyTurn, attacker, targetPlayer, magicPlan }) {
  if (!room) return null;

  if (room.status === "lobby") {
    return { tone: "neutral", title: "等待開始遊戲", steps: ["房主可以按「開始遊戲」。", "其他玩家等待房主開始。"] };
  }

  if (!isMyTurn) {
    const current = room.players.find((p) => p.id === room.currentPlayerId);
    return { tone: "waiting", title: `等待 ${current?.name || "其他玩家"} 行動`, steps: ["現在不是你的回合。", "你可以觀察場上兵種、HP 與遊戲紀錄。"] };
  }

  if (magicPlan) {
    if (magicPlan.step === "caster") {
      return {
        tone: "magic",
        title: `魔法步驟 1：選擇施法者`,
        steps: [
          `你正在使用：${magicPlan.magic.name}。`,
          "請選擇我方場上一名法師作為施法者。",
          "選好後按「確認施法者」。"
        ],
      };
    }

    if (magicPlan.step === "target") {
      return {
        tone: "magic",
        title: `魔法步驟 2：選擇目標`,
        steps: [
          "請先選目標玩家。",
          magicPlan.magic.name === "天殞術" ? "天殞術是全場效果，不需要選單一兵種。" : "接著選擇要施法的目標兵種。",
          "切換目標玩家時，系統會自動清空原本選到的目標。"
        ],
      };
    }

    if (magicPlan.step === "confirm") {
      return {
        tone: "magic",
        title: `魔法步驟 3：確認施放`,
        steps: [
          "請確認魔法卡、施法者、目標玩家與目標兵種是否正確。",
          "確認無誤後，按「確認施放」。"
        ],
      };
    }
  }

  if (attacker) {
    return {
      tone: "attack",
      title: `已選擇攻擊者：${attacker.name}`,
      steps: [
        "下一步：點選敵方兵種進行攻擊。",
        targetPlayer?.field?.some((u) => u.type === "步兵")
          ? "敵方場上有步兵，必須先消滅步兵，不能直接攻擊國王。"
          : "敵方沒有步兵，可以直接攻擊國王。",
      ],
    };
  }

  return {
    tone: "active",
    title: "輪到你行動",
    steps: ["你可以部署任意數量兵種，直到場上滿 5 張。", "你可以點選可行動兵種作為攻擊者。", "你可以點選魔法卡，依提示選法師與目標。", "完成後按「結束回合」。"],
  };
}

function GuidePanel({ hint }) {
  if (!hint) return null;
  return (
    <section className={`guidePanel ${hint.tone || "neutral"}`}>
      <div>
        <div className="guideLabel">操作提示</div>
        <h2>{hint.title}</h2>
      </div>
      <ol>{hint.steps.map((step, idx) => <li key={idx}>{step}</li>)}</ol>
    </section>
  );
}

function PlayerSummary({ player, isMe, isCurrent }) {
  return (
    <article className={`playerSummary ${isCurrent ? "current" : ""} ${player.eliminated ? "dead" : ""}`}>
      <div className="playerSummaryTop">
        <strong>{player.name}{isMe ? "（你）" : ""}</strong>
        <span>HP {player.hp}</span>
      </div>

      {player.king && (
        <div className="kingMini">
          <KingArt king={player.king} />
          <div>
            <strong>{player.king.name}</strong>
            <small>{player.king.effectName}：{player.king.effect}</small>
          </div>
        </div>
      )}

      <div className="playerStats">
        <span>手牌 {player.handCount}</span>
        <span>魔法 {player.magicCount}</span>
        <span>場上 {player.field.length}/5</span>
      </div>
    </article>
  );
}

function UnitCard({ card, onClick, selected, disabled, actionLabel, compact = false, highlight = "" }) {
  return (
    <button className={`gameCard unit ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${highlight}`} disabled={disabled} onClick={onClick}>
      <CardArt card={card} small={compact} />
      <strong>{card.name}</strong>
      <span>傷害 {card.damage}｜剋 {card.counterTarget}</span>
      <span className={`statusPill ${unitStatusText(card)}`}>{unitStatusText(card)}</span>
      <span className="effectText">{unitEffectText(card)}</span>
      {card.status?.length > 0 && <span className="status">{card.status.join("、")}</span>}
      {actionLabel && <span className="actionLabel">{actionLabel}</span>}
    </button>
  );
}

function MagicCard({ card, onClick, disabled, selected }) {
  return (
    <button className={`gameCard magic ${selected ? "selected" : ""}`} disabled={disabled} onClick={onClick}>
      <CardArt card={card} />
      <strong>{card.name}</strong>
      <span>{card.level}｜目標：{card.target}</span>
      <span className="effectText">{card.text}</span>
      <span className="actionLabel">使用魔法</span>
    </button>
  );
}

function EmptyState({ children }) {
  return <div className="emptyState">{children}</div>;
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
  const [showHelp, setShowHelp] = useState(true);

  React.useEffect(() => {
    socket.on("room:update", (next) => {
      setRoom(next);
      const firstEnemy = next.players.find((p) => p.id !== playerId && !p.eliminated);
      if (!targetPlayerId && firstEnemy) setTargetPlayerId(firstEnemy.id);
    });
    return () => socket.off("room:update");
  }, [socket, playerId, targetPlayerId]);

  const emit = (event, data = {}) => socket.emit(event, data, (res) => res?.ok ? setMessage("") : setMessage(res?.error || "操作失敗"));
  const safeName = () => Array.from((name || "").normalize("NFKC").trim() || "玩家").slice(0, 16).join("");

  function createRoom() {
    socket.emit("room:create", { name: safeName(), maxPlayers }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "建立失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      setMessage("");
    });
  }

  function joinRoom() {
    socket.emit("room:join", { name: safeName(), code: roomCodeInput }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "加入失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      setMessage("");
    });
  }

  function randomMatch() {
    setMessage("正在尋找玩家...");
    socket.emit("matchmaking:join", { name: safeName() }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "隨機匹配失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      setMessage(res.waiting ? "正在等待另一位玩家加入..." : "");
    });
  }

  if (!room) {
    return (
      <main className="page centered">
        <section className="card hero newHero">
          <div className="titleBadge">Online Multiplayer</div>
          <h1>國王戰爭</h1>
          <p>新手引導版 UI：進入遊戲後會提示你每一步可以做什麼。</p>

          <label>暱稱 / 遊戲 ID</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 Wayne" />

          <div className="twoCols">
            <section className="startBox">
              <h2>創建房間</h2>
              <label>遊玩人數</label>
              <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
                {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} 人</option>)}
              </select>
              <button className="primaryBtn" onClick={createRoom}>創建房間</button>
            </section>

            <section className="startBox">
              <h2>加入房間</h2>
              <label>房間代碼</label>
              <input value={roomCodeInput} onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())} placeholder="例如 KW1234" />
              <button className="primaryBtn" onClick={joinRoom}>加入房間</button>
            </section>

            <section className="startBox matchBox">
              <h2>隨機匹配</h2>
              <p>不用房間代碼。系統會幫你配對另一位正在等待的玩家。</p>
              <button className="matchBtn" onClick={randomMatch}>開始隨機匹配</button>
            </section>
          </div>

          <div className="quickRules">
            <strong>遊戲目標：</strong>把其他玩家國王 HP 打到 0。<br />
            <strong>每回合：</strong>部署兵種、攻擊、使用魔法，最後結束回合。
          </div>

          {message && <p className="error">{message}</p>}
        </section>
      </main>
    );
  }

  const me = room.players.find((p) => p.id === playerId);
  const isHost = room.hostId === playerId;
  const isMyTurn = room.currentPlayerId === playerId;
  const enemies = room.players.filter((p) => p.id !== playerId && !p.eliminated);
  const targetPlayer = room.players.find((p) => p.id === targetPlayerId) || enemies[0];
  const attacker = me?.field.find((u) => u.id === attackerId);
  const magicTargetPlayer = room.players.find((p) => p.id === magicPlan?.targetPlayerId);
  const hint = actionHint({ room, me, isMyTurn, attacker, targetPlayer, magicPlan });

  if (room.status === "lobby") {
    return (
      <main className="page centered">
        <section className="card hero lobbyCard">
          <div className="titleBadge">Room Code</div>
          <h1>{room.roomCode}</h1>
          <p>把房間代碼傳給朋友，等人到齊後由房主開始遊戲。</p>

          <div className="playerList">
            {room.players.map((p) => (
              <div key={p.id} className="playerRow">
                <strong>{p.name}</strong>
                <span>{p.isHost ? "房主" : "玩家"}｜{p.connected ? "在線" : "斷線"}</span>
              </div>
            ))}
          </div>

          <p>人數：{room.players.length} / {room.maxPlayers}</p>

          {isHost ? <button className="primaryBtn" onClick={() => emit("game:start")}>開始遊戲</button> : <p className="waitingText">等待房主開始遊戲...</p>}
          {message && <p className="error">{message}</p>}
        </section>
      </main>
    );
  }

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

  function beginMagic(magic) {
    setMagicPlan({
      magic,
      step: "caster",
      casterId: "",
      targetPlayerId: magic.target === "我方" ? playerId : targetPlayer?.id || "",
      targetUnitIds: []
    });
    setAttackerId(null);
  }

  function confirmMagicCaster() {
    if (!magicPlan?.casterId) {
      return setMessage("請先選擇一名我方法師作為施法者。");
    }

    setMagicPlan({
      ...magicPlan,
      step: "target",
      targetUnitIds: []
    });
    setMessage("");
  }

  function confirmMagicTarget() {
    if (!magicPlan?.targetPlayerId) {
      return setMessage("請先選擇目標玩家。");
    }

    if (magicPlan.magic.name !== "天殞術" && magicPlan.targetUnitIds.length === 0) {
      return setMessage("請至少選擇一個魔法目標。");
    }

    setMagicPlan({
      ...magicPlan,
      step: "confirm"
    });
    setMessage("");
  }

  function backMagicStep() {
    if (!magicPlan) return;

    if (magicPlan.step === "target") {
      setMagicPlan({
        ...magicPlan,
        step: "caster",
        targetUnitIds: []
      });
      return;
    }

    if (magicPlan.step === "confirm") {
      setMagicPlan({
        ...magicPlan,
        step: "target"
      });
    }
  }

  function chooseMagicTarget(unitId) {
    if (!magicPlan) return;
    const max = magicPlan.magic.maxTargets || 1;
    const has = magicPlan.targetUnitIds.includes(unitId);
    let ids = [...magicPlan.targetUnitIds];

    if (has) ids = ids.filter((id) => id !== unitId);
    else if (max === 1) ids = [unitId];
    else if (ids.length < max) ids.push(unitId);

    setMagicPlan({ ...magicPlan, targetUnitIds: ids });
  }

  function castMagic() {
    if (!magicPlan) return;

    if (!magicPlan.casterId) {
      return setMessage("請先選擇一名我方法師作為施法者。");
    }

    if (!magicPlan.targetPlayerId) {
      return setMessage("請先選擇目標玩家。");
    }

    if (magicPlan.magic.name !== "天殞術" && magicPlan.targetUnitIds.length === 0) {
      return setMessage("請至少選擇一個魔法目標。");
    }

    emit("game:castMagic", {
      magicId: magicPlan.magic.id,
      casterId: magicPlan.casterId,
      targetPlayerId: magicPlan.targetPlayerId,
      targetUnitIds: magicPlan.targetUnitIds
    });

    setMagicPlan(null);
  }

  function selectOwnUnit(card) {
    if (!isMyTurn) return;

    if (magicPlan) {
      if (magicPlan.step === "caster") {
        if (card.type !== "法師") {
          return setMessage("請選擇法師作為施法者。");
        }

        setMagicPlan({
          ...magicPlan,
          casterId: card.id
        });
        setMessage("");
        return;
      }

      if (magicPlan.step === "target" && magicPlan.magic.target === "我方") {
        chooseMagicTarget(card.id);
        return;
      }

      return;
    }

    setAttackerId(card.id);
  }

  function enemyCardActionLabel(card) {
    if (!isMyTurn) return "";

    if (magicPlan) {
      if (magicPlan.step !== "target") return "";
      if (magicPlan.magic.target === "我方") return "";
      if (magicPlan.magic.name === "天殞術") return "";
      return magicPlan.targetUnitIds.includes(card.id) ? "已選目標" : "選為魔法目標";
    }

    if (attackerId) return "攻擊此兵種";
    return "先選我方攻擊者";
  }

  function ownCardActionLabel(card) {
    if (!isMyTurn) return "";

    if (magicPlan) {
      if (magicPlan.step === "caster") {
        return card.type === "法師"
          ? magicPlan.casterId === card.id ? "已選施法者" : "選為施法者"
          : "不是法師";
      }

      if (magicPlan.step === "target" && magicPlan.magic.target === "我方") {
        return magicPlan.targetUnitIds.includes(card.id) ? "已選目標" : "選為魔法目標";
      }

      return "";
    }

    return "選為攻擊者";
  }

  const targetHasInfantry = targetPlayer?.field?.some((u) => u.type === "步兵");

  return (
    <main className="page guidedPage">
      <header className="topbar guidedTopbar">
        <div>
          <div className="titleBadge">Room {room.roomCode}</div>
          <h1>國王戰爭</h1>
          <p>{isMyTurn ? "輪到你行動" : "等待其他玩家行動"}</p>
        </div>

        <div className="topActions">
          <button className="secondary" onClick={() => setShowHelp((v) => !v)}>{showHelp ? "隱藏提示" : "顯示提示"}</button>
          <button className="endTurnBtn" disabled={!isMyTurn} onClick={() => emit("game:endTurn")}>結束回合</button>
        </div>
      </header>

      {message && <p className="error floatingError">{message}</p>}
      {showHelp && <GuidePanel hint={hint} />}

      <section className="playerStrip">
        {room.players.map((p) => <PlayerSummary key={p.id} player={p} isMe={p.id === playerId} isCurrent={p.id === room.currentPlayerId} />)}
      </section>

      <section className="targetBar card">
        <div>
          <h2>目標玩家</h2>
          <p>選擇你要攻擊或施法的對象。</p>
        </div>
        <select value={targetPlayer?.id || ""} onChange={(e) => setTargetPlayerId(e.target.value)}>
          {enemies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </section>

      <section className="battleGrid">
        <section className="zoneCard enemyZone">
          <div className="zoneHeader">
            <div>
              <h2>{targetPlayer?.name || "敵方"} 場上</h2>
              <p>{targetHasInfantry ? "有步兵保護國王" : "可以攻擊國王"}</p>
            </div>
            <button className="dangerBtn" disabled={!isMyTurn || !attackerId || targetHasInfantry || !!magicPlan} onClick={attackKing}>攻擊國王</button>
          </div>

          <div className="cardGrid">
            {targetPlayer?.field?.length ? (
              targetPlayer.field.map((card) => (
                <UnitCard
                  key={card.id}
                  card={card}
                  selected={magicPlan?.targetUnitIds.includes(card.id)}
                  disabled={!isMyTurn || (magicPlan && (magicPlan.magic.target === "我方" || magicPlan.magic.name === "天殞術"))}
                  onClick={() => (magicPlan ? chooseMagicTarget(card.id) : attackUnit(card.id))}
                  actionLabel={enemyCardActionLabel(card)}
                  highlight={attackerId && !magicPlan ? "attackable" : ""}
                />
              ))
            ) : <EmptyState>敵方場上沒有兵種。</EmptyState>}
          </div>
        </section>

        <section className="zoneCard myZone">
          <div className="zoneHeader">
            <div>
              <h2>我方場上</h2>
              <p>先選擇攻擊者，或在施法時選擇法師。</p>
            </div>
          </div>

          <div className="cardGrid">
            {me?.field?.length ? (
              me.field.map((card) => (
                <div key={card.id} className="unitWrap">
                  <UnitCard
                    card={card}
                    selected={attackerId === card.id || magicPlan?.casterId === card.id || magicPlan?.targetUnitIds.includes(card.id)}
                    disabled={!isMyTurn || (magicPlan && magicPlan.casterId && magicPlan.magic.target !== "我方")}
                    onClick={() => selectOwnUnit(card)}
                    actionLabel={ownCardActionLabel(card)}
                    highlight={!card.tapped && !magicPlan ? "ready" : ""}
                  />
                  {me?.king?.name === "成吉思汗" && isMyTurn && !magicPlan && <button className="smallBtn" onClick={() => emit("game:recall", { unitId: card.id })}>撤回</button>}
                </div>
              ))
            ) : <EmptyState>你目前沒有場上兵種。可以先從手牌部署。</EmptyState>}
          </div>
        </section>
      </section>

      {magicPlan && (
        <section className="magicPanel guidedMagicPanel">
          <div>
            <div className="titleBadge">MAGIC STEP</div>
            <h2>施放魔法：{magicPlan.magic.name}</h2>
            <p>{magicPlan.magic.text}</p>

            <div className="magicStepBar">
              <span className={magicPlan.step === "caster" ? "active" : ""}>1 選施法者</span>
              <span className={magicPlan.step === "target" ? "active" : ""}>2 選目標</span>
              <span className={magicPlan.step === "confirm" ? "active" : ""}>3 確認施放</span>
            </div>

            <p>施法者：{me?.field.find((u) => u.id === magicPlan.casterId)?.name || "尚未選擇"}</p>
          </div>

          <div className="magicControls">
            {magicPlan.step === "caster" && (
              <>
                <h3>第一步：選擇我方法師</h3>
                <p>只有法師可以使用魔法。使用魔法視為該法師本回合攻擊一次。</p>

                <div className="cardGrid compactGrid">
                  {me?.field?.filter((card) => card.type === "法師").length ? (
                    me.field.filter((card) => card.type === "法師").map((card) => (
                      <UnitCard
                        key={card.id}
                        card={card}
                        compact
                        selected={magicPlan.casterId === card.id}
                        onClick={() => selectOwnUnit(card)}
                        actionLabel={magicPlan.casterId === card.id ? "已選施法者" : "選為施法者"}
                      />
                    ))
                  ) : (
                    <EmptyState>你場上沒有法師，不能使用魔法。</EmptyState>
                  )}
                </div>

                <div className="panelActions">
                  <button className="primaryBtn" disabled={!magicPlan.casterId} onClick={confirmMagicCaster}>確認施法者</button>
                  <button className="secondary" onClick={() => setMagicPlan(null)}>取消</button>
                </div>
              </>
            )}

            {magicPlan.step === "target" && (
              <>
                <h3>第二步：選擇目標玩家與目標兵種</h3>

                <label>目標玩家</label>
                <select
                  value={magicPlan.targetPlayerId}
                  onChange={(e) =>
                    setMagicPlan({
                      ...magicPlan,
                      targetPlayerId: e.target.value,
                      targetUnitIds: []
                    })
                  }
                >
                  {(magicPlan.magic.target === "我方" ? [me] : enemies).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                <p>
                  {magicPlan.magic.name === "天殞術"
                    ? "天殞術是全場效果，不用選單一兵種。"
                    : `已選目標：${magicPlan.targetUnitIds.length}/${magicPlan.magic.maxTargets || 1}`}
                </p>

                {magicTargetPlayer?.field?.length > 0 && magicPlan.magic.name !== "天殞術" && (
                  <div className="cardGrid compactGrid">
                    {magicTargetPlayer.field.map((card) => (
                      <UnitCard
                        key={card.id}
                        card={card}
                        compact
                        selected={magicPlan.targetUnitIds.includes(card.id)}
                        onClick={() => chooseMagicTarget(card.id)}
                        actionLabel={magicPlan.targetUnitIds.includes(card.id) ? "已選目標" : "選擇目標"}
                      />
                    ))}
                  </div>
                )}

                {(!magicTargetPlayer?.field?.length && magicPlan.magic.name !== "天殞術") && (
                  <EmptyState>這位玩家場上沒有兵種可以選。</EmptyState>
                )}

                <div className="panelActions">
                  <button className="primaryBtn" onClick={confirmMagicTarget}>確認目標</button>
                  <button className="secondary" onClick={backMagicStep}>上一步</button>
                  <button className="secondary" onClick={() => setMagicPlan(null)}>取消</button>
                </div>
              </>
            )}

            {magicPlan.step === "confirm" && (
              <>
                <h3>第三步：確認施放</h3>

                <div className="confirmBox">
                  <p><strong>魔法卡：</strong>{magicPlan.magic.name}</p>
                  <p><strong>施法者：</strong>{me?.field.find((u) => u.id === magicPlan.casterId)?.name || "未選擇"}</p>
                  <p><strong>目標玩家：</strong>{room.players.find((p) => p.id === magicPlan.targetPlayerId)?.name || "未選擇"}</p>
                  <p>
                    <strong>目標兵種：</strong>
                    {magicPlan.magic.name === "天殞術"
                      ? "全場效果"
                      : magicTargetPlayer?.field
                          ?.filter((u) => magicPlan.targetUnitIds.includes(u.id))
                          .map((u) => u.name)
                          .join("、") || "未選擇"}
                  </p>
                </div>

                <div className="panelActions">
                  <button className="primaryBtn" onClick={castMagic}>確認施放</button>
                  <button className="secondary" onClick={backMagicStep}>上一步</button>
                  <button className="secondary" onClick={() => setMagicPlan(null)}>取消</button>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <section className="handAndLog">
        <section className="zoneCard">
          <div className="zoneHeader">
            <div>
              <h2>兵種手牌</h2>
              <p>點選卡牌即可部署。可部署多張，直到場上滿 5 張。</p>
            </div>
          </div>

          <div className="cardGrid">
            {me?.hand?.length ? (
              me.hand.map((card) => (
                <button key={card.id} className="gameCard unit handCard" disabled={!isMyTurn || !!magicPlan} onClick={() => emit("game:deploy", { cardId: card.id })}>
                  <CardArt card={card} />
                  <strong>{card.name}</strong>
                  <span>傷害 {card.damage}｜剋 {card.counterTarget}</span>
                  <span className="effectText">{unitEffectText(card)}</span>
                  <span className="actionLabel">部署</span>
                </button>
              ))
            ) : <EmptyState>沒有兵種手牌。</EmptyState>}
          </div>
        </section>

        <aside className="sideColumn">
          <section className="zoneCard">
            <h2>魔法卡</h2>
            <p>先點魔法卡，再依提示選法師與目標。</p>
            <div className="magicList">
              {me?.magic?.length ? me.magic.map((card) => <MagicCard key={card.id} card={card} disabled={!isMyTurn || !!magicPlan} onClick={() => beginMagic(card)} />) : <EmptyState>沒有魔法卡。場上有法師時，回合開始會抽魔法。</EmptyState>}
            </div>
          </section>

          <section className="zoneCard">
            <h2>兵種相剋</h2>
            <div className="counterList">
              <span>步兵 → 弓兵</span>
              <span>弓兵 → 法師</span>
              <span>法師 → 騎兵</span>
              <span>騎兵 → 步兵</span>
            </div>
          </section>

          <section className="zoneCard">
            <h2>遊戲紀錄</h2>
            <div className="log">{room.log.slice().reverse().map((line, i) => <div key={i}>{line}</div>)}</div>
          </section>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
