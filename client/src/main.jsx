import React, { useMemo, useRef, useState } from "react";
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
  if (card.type === "弓兵") return "遠射：攻擊戰力低於自己的敵人時，第一次可再攻擊一次；攻擊戰力等於或高於自己的敵人時不死亡；若攻擊戰力高於自己的敵人，下回合不能攻擊。";
  if (card.type === "法師") return "施法：回合開始時依場上法師數抽魔法卡。使用魔法視為一次攻擊。剛部署時不能使用同級魔法。";
  if (card.type === "騎兵") return "突擊：剛部署的回合即可攻擊；但高級騎兵仍須整備一回合；整備中不能攻擊，且目前戰力-1。";
  return "";
}

function effectivePower(card) {
  if (!card) return 0;

  const rankMap = {
    "初級": 1,
    "中級": 2,
    "高級": 3
  };

  const statuses = card.status || [];
  let value = rankMap[card.rank] || 1;

  if (statuses.includes("整備")) value -= 1;
  if (statuses.includes("階級-1") || statuses.includes("戰力-1") || statuses.includes("階級-1") || statuses.includes("戰力-1")) value -= 1;
  if (statuses.includes("階級+1") || statuses.includes("戰力+1") || statuses.includes("階級+1") || statuses.includes("戰力+1")) value += 1;
  if (statuses.includes("力量術+1")) value += 1;
  if (statuses.includes("屋大維+1")) value += 1;

  return Math.max(1, value);
}

function displayStatusLabel(status) {
  const s = String(status || "");

  if (s === "戰力+1") return "戰力+1";
  if (s === "戰力-1") return "戰力-1";
  if (s === "力量術+1") return "力量術：戰力+1";
  if (s === "屋大維+1") return "屋大維：戰力+1";
  if (s === "傷害+1") return "攻擊國王傷害+1";
  if (s === "燃血+1傷害") return "燃血：攻擊國王傷害+1";
  if (s === "整備") return "整備：不能攻擊，戰力-1";
  if (s === "急援") return "急援：本回合可以攻擊";
  if (s === "疲乏" || s === "疲乏待解") return "疲乏：下回合不能攻擊";

  return s.replaceAll("階級", "戰力");
}

function canUnitStillAct(card) {
  if (!card) return false;

  const statuses = card.status || [];

  return !card.tapped &&
    !statuses.includes("整備") &&
    !statuses.includes("不能攻擊") &&
    !statuses.includes("疲乏") &&
    !statuses.includes("疲乏待解");
}

function cardDetailText(card) {
  if (!card) return "";

  if (card.kind === "magic") {
    return card.text || "這張魔法卡沒有額外描述。";
  }

  if (card.kind === "king") {
    return card.effect || "這張國王卡沒有額外描述。";
  }

  return unitEffectText(card) || unitStatusText(card);
}

function shouldBlockUnitCardDetail(card, source = "卡片") {
  const sourceText = String(source || "");

  // 兵種手牌 / 兵種卡 / 我方兵種 / 敵方兵種，都禁止長按資訊。
  if (sourceText.includes("兵種")) return true;

  // 兵種卡通常會有 damage / counterTarget / rank / type。
  if (card?.damage !== undefined) return true;
  if (card?.counterTarget !== undefined) return true;

  // 明確標記為 unit 也禁止。
  if (card?.kind === "unit") return true;

  // 沒有 kind，但有兵種類型時，也視為兵種卡。
  const unitTypes = ["步兵", "弓兵", "法師", "騎兵"];
  if (!card?.kind && unitTypes.includes(card?.type)) return true;

  return false;
}

function buildCardDetail(card, source = "卡片") {
  if (!card) return null;

  const isUnit = !card.kind || card.kind === "unit";

  return {
    source,
    name: card.name,
    kind: card.kind || "unit",
    rank: card.rank || card.level || "",
    type: card.type || "",
    text: cardDetailText(card),
    status: card.status || [],
    power: isUnit ? effectivePower(card) : null
  };
}

function unitStatusText(card) {
  if (!card) return "";
  if (card.status?.includes("整備")) return "整備中";
  if (card.status?.includes("不能攻擊")) return "不能攻擊";
  if (card.status?.includes("疲乏") || card.status?.includes("疲乏待解")) return "疲乏";
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

function PlayerSummary({ player, isMe, isCurrent, onDetail }) {
  let pressTimer = null;

  function startPress() {
    if (!onDetail || !player.king) return;
    pressTimer = window.setTimeout(() => {
      onDetail({ ...player.king, kind: "king" }, "國王");
    }, 450);
  }

  function cancelPress() {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  return (
    <article className={`playerSummary ${isMe ? "me" : "opponent"} ${isCurrent ? "current" : ""} ${player.eliminated ? "dead" : ""}`}>
      <div className="playerSummaryTop">
        <strong>{player.name}{isMe ? "（你）" : ""}</strong>
        <span>HP {player.hp}</span>
      </div>

      {player.king && (
        <div
          className="kingMini"
          onDoubleClick={() => onDetail?.({ ...player.king, kind: "king" }, "國王")}
          onContextMenu={(e) => {
            e.preventDefault();
            onDetail?.({ ...player.king, kind: "king" }, "國王");
          }}
          onMouseDown={startPress}
          onMouseUp={cancelPress}
          onMouseLeave={cancelPress}
          onTouchStart={startPress}
          onTouchEnd={cancelPress}
        >
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



function UnitCard({ card, onClick, selected, disabled, actionLabel, compact = false, highlight = "", onDetail, onAction }) {
  let pressTimer = null;

  function startPress() {
    // UNIT_CARD_LONG_PRESS_DISABLED_V2
    return;
  }

  function cancelPress() {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function handleClick() {
    if (disabled) return;

    if (onAction) {
      onAction(card, actionLabel || "執行這張卡的操作", onClick, "兵種卡");
      return;
    }

    onClick?.();
  }

  return (
    <button
      className={`gameCard unit ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${highlight}`}
      disabled={disabled}
      onClick={handleClick}
      onDoubleClick={(e) => {
        e.preventDefault();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
    >
      <CardArt card={card} small={compact} />
      <strong>{card.name}</strong>
      <span className="miniLine">傷害 {card.damage}｜剋 {card.counterTarget}</span>
      <span className="powerText">戰力 {effectivePower(card)}</span>
      <span className={`statusPill ${unitStatusText(card)}`}>{unitStatusText(card)}</span>
      <span className="effectText">{unitEffectText(card)}</span>
      {card.status?.length > 0 && <span className="status">{card.status.map(displayStatusLabel).join("、")}</span>}
      {actionLabel && <span className="actionLabel">{actionLabel}</span>}
    </button>
  );
}



function MagicCard({ card, onClick, disabled, selected, onDetail, onAction }) {
  let pressTimer = null;

  function startPress() {
    if (!onDetail) return;
    pressTimer = window.setTimeout(() => {
      onDetail(card, "魔法卡");
    }, 450);
  }

  function cancelPress() {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function handleClick() {
    if (disabled) return;

    if (onAction) {
      onAction(card, "使用這張魔法卡", onClick, "魔法卡");
      return;
    }

    onClick?.();
  }

  return (
    <button
      className={`gameCard magic ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={handleClick}
      onDoubleClick={(e) => {
        e.preventDefault();
        onDetail?.(card, "魔法卡");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onDetail?.(card, "魔法卡");
      }}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
    >
      <CardArt card={card} />
      <strong>{card.name}</strong>
      <span className="miniLine">{card.level}｜{card.target}</span>
      <span className="effectText">{card.text}</span>
      <span className="actionLabel">使用魔法</span>
    </button>
  );
}



function EmptyState({ children }) {
  return <div className="emptyState">{children}</div>;
}

function TutorialModal({ step, setStep, onClose }) {
  const item = tutorialSteps[step];
  const isFirst = step === 0;
  const isLast = step === tutorialSteps.length - 1;

  return (
    <section className="tutorialOverlay">
      <div className="tutorialModal">
        <div className="tutorialTop">
          <span className="tutorialBadge">新手操作教學</span>
          <button className="secondary tutorialClose" onClick={onClose}>關閉</button>
        </div>

        <div className="tutorialProgress">
          {tutorialSteps.map((_, index) => (
            <span key={index} className={index === step ? "active" : ""}>
              {index + 1}
            </span>
          ))}
        </div>

        <div className="tutorialCard">
          <div className="tutorialTag">{item.tag}</div>
          <h2>{item.title}</h2>
          <p>{item.text}</p>
          <div className="tutorialTip">提示：{item.tip}</div>
        </div>

        <div className="tutorialPreview">
          <div className="tutorialBoard enemy">敵方場地</div>
          <div className="tutorialBoard center">選擇攻擊者 → 選擇目標 → 確認行動</div>
          <div className="tutorialBoard mine">我方場地 / 手牌</div>
        </div>

        <div className="tutorialActions">
          <button className="secondary" disabled={isFirst} onClick={() => setStep(step - 1)}>上一步</button>
          <button
            className="primaryBtn"
            onClick={() => {
              if (isLast) onClose();
              else setStep(step + 1);
            }}
          >
            {isLast ? "完成教學" : "下一步"}
          </button>
        </div>
      </div>
    </section>
  );
}

const tutorialSteps = [
  {
    title: "第 1 步：部署兵種",
    tag: "出牌",
    text: "從手牌選一張兵種卡放到自己的場上。場上最多可以有 5 張兵種。",
    tip: "剛部署的兵種通常不能立刻攻擊，但騎兵可以。"
  },
  {
    title: "第 2 步：選擇攻擊者",
    tag: "攻擊",
    text: "點選我方場上可以行動的兵種，讓它成為攻擊者。",
    tip: "已行動、整備、疲乏或不能攻擊的兵種，這回合不能攻擊。"
  },
  {
    title: "第 3 步：攻擊敵人",
    tag: "戰鬥",
    text: "選好攻擊者後，可以攻擊敵方兵種。如果敵方場上沒有步兵，也可以直接攻擊國王。",
    tip: "步兵有守衛效果，敵方有步兵時不能直接打國王。"
  },
  {
    title: "第 4 步：使用魔法",
    tag: "魔法",
    text: "點選魔法卡後，依序選擇施法者、目標玩家、目標兵種，最後確認施放。",
    tip: "使用魔法需要法師，而且使用魔法也算一次行動。"
  },
  {
    title: "第 5 步：結束回合",
    tag: "回合",
    text: "部署、攻擊、使用魔法都完成後，按下結束回合。系統會提醒你是否還有兵種尚未行動。",
    tip: "目標是把其他玩家的國王 HP 打到 0。"
  }
];

function InteractiveTutorial({ onExit }) {
  const [step, setStep] = React.useState(0);
  const [deployed, setDeployed] = React.useState(false);
  const [attackerSelected, setAttackerSelected] = React.useState(false);
  const [enemyDefeated, setEnemyDefeated] = React.useState(false);
  const [magicOpened, setMagicOpened] = React.useState(false);
  const [casterSelected, setCasterSelected] = React.useState(false);
  const [magicTargetSelected, setMagicTargetSelected] = React.useState(false);
  const [magicCast, setMagicCast] = React.useState(false);
  const [turnEnded, setTurnEnded] = React.useState(false);

  const steps = [
    {
      title: "第 1 步：部署兵種",
      text: "請點選下方手牌中的「初級步兵」，把它放到自己的場上。",
    },
    {
      title: "第 2 步：選擇攻擊者",
      text: "請點選我方場上的「初級步兵」，讓它成為攻擊者。",
    },
    {
      title: "第 3 步：攻擊敵方兵種",
      text: "請點選敵方場上的「初級弓兵」，完成一次攻擊。",
    },
    {
      title: "第 4 步：使用魔法卡",
      text: "請點選下方的「力量術」，進入魔法施放流程。",
    },
    {
      title: "第 5 步：選施法者與目標",
      text: "請依序選擇法師、選擇我方步兵作為目標，最後確認施放。",
    },
    {
      title: "第 6 步：結束回合",
      text: "完成部署、攻擊與魔法後，請按「結束回合」。",
    },
    {
      title: "教學完成",
      text: "你已經完成基本操作。接下來可以創建房間、加入房間，或用隨機匹配開始遊戲。",
    },
  ];

  const current = steps[step];

  function deployUnit() {
    if (step !== 0) return;
    setDeployed(true);
    setStep(1);
  }

  function selectAttacker() {
    if (step !== 1 || !deployed) return;
    setAttackerSelected(true);
    setStep(2);
  }

  function attackEnemy() {
    if (step !== 2 || !attackerSelected) return;
    setEnemyDefeated(true);
    setStep(3);
  }

  function openMagic() {
    if (step !== 3) return;
    setMagicOpened(true);
    setStep(4);
  }

  function selectCaster() {
    if (step !== 4 || !magicOpened) return;
    setCasterSelected(true);
  }

  function selectMagicTarget() {
    if (step !== 4 || !casterSelected) return;
    setMagicTargetSelected(true);
  }

  function confirmMagic() {
    if (step !== 4 || !casterSelected || !magicTargetSelected) return;
    setMagicCast(true);
    setStep(5);
  }

  function endTutorialTurn() {
    if (step !== 5) return;
    setTurnEnded(true);
    setStep(6);
  }

  function resetTutorial() {
    setStep(0);
    setDeployed(false);
    setAttackerSelected(false);
    setEnemyDefeated(false);
    setMagicOpened(false);
    setCasterSelected(false);
    setMagicTargetSelected(false);
    setMagicCast(false);
    setTurnEnded(false);
  }

  return (
    <main className="page tutorialPlayPage">
      <header className="tutorialPlayTopbar">
        <div>
          <div className="titleBadge">Tutorial</div>
          <h1>國王戰爭操作教學</h1>
          <p>照著提示點擊，完成一回合的基本操作。</p>
        </div>

        <div className="topActions">
          <button className="secondary" onClick={resetTutorial}>重新教學</button>
          <button className="secondary" onClick={onExit}>回到主選單</button>
        </div>
      </header>

      <section className="tutorialMission">
        <div className="tutorialMissionText">
          <span>目前步驟 {Math.min(step + 1, steps.length)} / {steps.length}</span>
          <h2>{current.title}</h2>
          <p>{current.text}</p>
        </div>

        <div className="tutorialStepDots">
          {steps.map((_, index) => (
            <b key={index} className={index === step ? "active" : index < step ? "done" : ""}>
              {index + 1}
            </b>
          ))}
        </div>
      </section>

      <section className="tutorialBattleTable">
        <div className="tutorialZone enemy">
          <div className="zoneHeader">
            <h2>敵方場地</h2>
            <p>訓練對手 HP 30</p>
          </div>

          <div className="tutorialCardRow">
            {!enemyDefeated ? (
              <button
                className={step === 2 ? "tutorialGameCard focus" : "tutorialGameCard"}
                disabled={step !== 2}
                onClick={attackEnemy}
              >
                <strong>初級弓兵</strong>
                <span>目前戰力：1</span>
                <small>{step === 2 ? "點我進行攻擊" : "敵方兵種"}</small>
              </button>
            ) : (
              <div className="tutorialEmpty">敵方兵種已被擊敗</div>
            )}
          </div>
        </div>

        <div className="tutorialCenter">
          <div className="tutorialInfoCard">
            <strong>操作提示</strong>
            <p>
              {step === 0 && "先從手牌部署兵種。"}
              {step === 1 && "部署後，選擇我方場上的兵種。"}
              {step === 2 && "選好攻擊者後，點擊敵方兵種。"}
              {step === 3 && "接著試著使用一張魔法卡。"}
              {step === 4 && "魔法需要施法者與目標。"}
              {step === 5 && "最後按結束回合。"}
              {step === 6 && "教學完成，可以開始正式遊戲。"}
            </p>
          </div>
        </div>

        <div className="tutorialZone mine">
          <div className="zoneHeader">
            <h2>我方場地</h2>
            <p>你的國王 HP 30</p>
          </div>

          <div className="tutorialCardRow">
            <button
              className={
                deployed
                  ? step === 1
                    ? "tutorialGameCard focus"
                    : attackerSelected
                      ? "tutorialGameCard selected"
                      : "tutorialGameCard"
                  : "tutorialGameCard placeholder"
              }
              disabled={!deployed || step !== 1}
              onClick={selectAttacker}
            >
              <strong>{deployed ? "初級步兵" : "尚未部署"}</strong>
              <span>{deployed ? "目前戰力：1" : "請先從手牌部署"}</span>
              <small>
                {deployed
                  ? attackerSelected
                    ? "已選為攻擊者"
                    : step === 1
                      ? "點我選為攻擊者"
                      : "我方兵種"
                  : "空位"}
              </small>
            </button>

            <button
              className={casterSelected ? "tutorialGameCard selected" : step === 4 ? "tutorialGameCard focusSoft" : "tutorialGameCard"}
              disabled={step !== 4 || !magicOpened || casterSelected}
              onClick={selectCaster}
            >
              <strong>初級法師</strong>
              <span>目前戰力：1</span>
              <small>{casterSelected ? "已選施法者" : "魔法施法者"}</small>
            </button>
          </div>
        </div>
      </section>

      {step === 4 && magicOpened && (
        <section className="tutorialMagicPanel">
          <h2>魔法施放流程：力量術</h2>

          <div className="magicStepBar">
            <span className={casterSelected ? "active" : ""}>1 選施法者</span>
            <span className={magicTargetSelected ? "active" : ""}>2 選目標</span>
            <span className={magicCast ? "active" : ""}>3 確認施放</span>
          </div>

          <div className="panelActions">
            <button disabled={casterSelected} onClick={selectCaster}>選擇初級法師</button>
            <button disabled={!casterSelected || magicTargetSelected} onClick={selectMagicTarget}>選擇初級步兵</button>
            <button disabled={!casterSelected || !magicTargetSelected} onClick={confirmMagic}>確認施放</button>
          </div>
        </section>
      )}

      <section className="tutorialHandBar">
        <div className="tutorialHandSection">
          <h2>你的兵種手牌</h2>
          <div className="tutorialCardRow">
            <button
              className={step === 0 ? "tutorialGameCard focus" : "tutorialGameCard"}
              disabled={step !== 0 || deployed}
              onClick={deployUnit}
            >
              <strong>初級步兵</strong>
              <span>守衛</span>
              <small>{step === 0 ? "點我部署" : deployed ? "已部署" : "兵種卡"}</small>
            </button>

            <button className="tutorialGameCard locked" disabled>
              <strong>中級騎兵</strong>
              <span>突擊</span>
              <small>教學中暫時鎖定</small>
            </button>
          </div>
        </div>

        <div className="tutorialHandSection">
          <h2>你的魔法卡</h2>
          <div className="tutorialCardRow">
            <button
              className={step === 3 ? "tutorialGameCard magic focus" : "tutorialGameCard magic"}
              disabled={step !== 3 || magicOpened}
              onClick={openMagic}
            >
              <strong>力量術</strong>
              <span>戰力 +1</span>
              <small>{step === 3 ? "點我使用魔法" : magicOpened ? "施放中" : "魔法卡"}</small>
            </button>
          </div>
        </div>

        <div className="tutorialEndBox">
          <button
            className="endTurnBtn"
            disabled={step !== 5 || turnEnded}
            onClick={endTutorialTurn}
          >
            結束回合
          </button>
        </div>
      </section>
    </main>
  );
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
  const [cardDetailModal, setCardDetailModal] = useState(null);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [mobileActionModal, setMobileActionModal] = useState(null);
  const [actionCardModal, setActionCardModal] = useState(null);
  const [tutorialMode, setTutorialMode] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [attackFeedback, setAttackFeedback] = useState(null);
  const lastLogRef = useRef("");
  const [turnOrderNotice, setTurnOrderNotice] = useState(null);
  const previousRoomStatusRef = useRef(null);
  const cardDetailPressTimerRef = useRef(null);

  function openCardDetail(card, source = "卡片") {
    // BLOCK_UNIT_CARD_DETAIL_V2
    if (shouldBlockUnitCardDetail(card, source)) {
      setCardDetailModal?.(null);
      return;
    }
    // UNIT_DETAIL_DISABLED_V1
    // 兵種牌種類不多，避免手機誤觸長按一直跳說明；兵種效果改放規則頁。
    const isUnitCard =
      (!card?.kind || card?.kind === "unit") &&
      source !== "國王" &&
      source !== "魔法卡";

    if (isUnitCard || String(source).includes("兵種")) {
      return;
    }
    const detail = buildCardDetail(card, source);
    if (!detail) return;
    setCardDetailModal(detail);
  }

  function openActionCardModal(card, actionText, runAction, source = "卡片") {
    // DEPLOY_MOBILE_MODAL_FINAL_V1
    setActionCardModal(null);
    openMobileActionModal(card, source, actionText, runAction);
  }

  function startCardDetailPress(card, source = "卡片") {
    // BLOCK_UNIT_CARD_DETAIL_PRESS_V2
    if (shouldBlockUnitCardDetail(card, source)) {
      window.clearTimeout(cardDetailPressTimerRef.current);
      cardDetailPressTimerRef.current = null;
      setCardDetailModal?.(null);
      return;
    }

    window.clearTimeout(cardDetailPressTimerRef.current);
    cardDetailPressTimerRef.current = window.setTimeout(() => {
      openCardDetail(card, source);
    }, 700);
  }

  function cancelCardDetailPress() {
    window.clearTimeout(cardDetailPressTimerRef.current);
    cardDetailPressTimerRef.current = null;
  }
  React.useEffect(() => {
    // kw_display_name_init
    const savedName = localStorage.getItem("kw_display_name");
    if (savedName && !name) setName(savedName);
  }, []);

  React.useEffect(() => {
    // turn_order_notice_effect
    const previousStatus = previousRoomStatusRef.current;
    previousRoomStatusRef.current = room?.status || null;

    if (!room || room.status !== "playing") return;
    if (previousStatus === "playing") return;

    const playerIndex = room.players.findIndex((p) => p.id === playerId);
    const firstPlayer = room.players.find((p) => p.id === room.currentPlayerId);
    const orderText = room.players.map((p) => p.name).join(" → ");

    if (playerIndex >= 0) {
      setTurnOrderNotice({
        orderText,
        myOrder: playerIndex + 1,
        firstPlayerName: firstPlayer?.name || room.players[0]?.name || "玩家"
      });

      const timer = setTimeout(() => {
        setTurnOrderNotice(null);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [room?.status, room?.roomCode, playerId]);

  React.useEffect(() => {
    // kw_close_detail_when_magic_changes
    if (magicPlan) {
      setCardDetailModal(null);
    }
  }, [magicPlan?.step, magicPlan?.casterId, magicPlan?.targetPlayerId, magicPlan?.targetUnitIds?.join(",")]);

  React.useEffect(() => {
    // kw_turn_timer_tick
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    socket.on("room:deleted", ({ reason } = {}) => {
      clearSavedSession();
      setRoom(null);
      setPlayerId(null);
      setTargetPlayerId("");
      setAttackerId(null);
      setMagicPlan(null);
      setMessage(reason || "房間已結束並清理。");
    });

    socket.on("room:update", (next) => {
      // kw_attack_feedback
      const latestLog = next?.log?.[next.log.length - 1] || "";

      if (latestLog && latestLog !== lastLogRef.current) {
        lastLogRef.current = latestLog;

        const isAttackEvent =
          latestLog.includes("攻擊") ||
          latestLog.includes("造成") ||
          latestLog.includes("消滅") ||
          latestLog.includes("出局");

        if (isAttackEvent) {
          setAttackFeedback(latestLog);

          if (navigator.vibrate) {
            navigator.vibrate(55);
          }

          window.clearTimeout(window.__kwAttackFeedbackTimer);
          window.__kwAttackFeedbackTimer = window.setTimeout(() => {
            setAttackFeedback(null);
          }, 1400);
        }
      }

      setRoom(next);
      const firstEnemy = next.players.find((p) => p.id !== playerId && !p.eliminated);
      if (!targetPlayerId && firstEnemy) setTargetPlayerId(firstEnemy.id);
    });
    return () => {
      // FINAL_OFF_ROOM_DELETED_TINY_V1
      socket.off("room:deleted");
      socket.off("room:update");
    };
  }, [socket, playerId, targetPlayerId]);

  React.useEffect(() => {
    // kw_session_resume
    function resumeSession() {
      const raw = localStorage.getItem("kw_session");
      if (!raw) return;

      try {
        const saved = JSON.parse(raw);
        if (!saved?.roomCode || !saved?.playerId) return;

        socket.emit("room:resume", saved, (res) => {
          if (!res?.ok) return;
          setPlayerId(res.playerId);
          setRoom(res.room);
          setMessage("");
        });
      } catch {
        localStorage.removeItem("kw_session");
      }
    }

    socket.on("connect", resumeSession);
    if (socket.connected) resumeSession();

    return () => socket.off("connect", resumeSession);
  }, [socket]);

  // AI visibility fix: keep target player as enemy.
  // 單人模式或房間更新時，避免目標玩家被錯設成自己，導致 AI 場地看起來消失。
  React.useEffect(() => {
    if (!room || !playerId) return;

    const validEnemy = room.players.find(
      (p) => p.id === targetPlayerId && p.id !== playerId && !p.eliminated
    );

    if (!validEnemy) {
      const firstEnemy = room.players.find((p) => p.id !== playerId && !p.eliminated);
      if (firstEnemy) setTargetPlayerId(firstEnemy.id);
    }
  }, [room, playerId, targetPlayerId]);

  const emit = (event, data = {}) => socket.emit(event, data, (res) => res?.ok ? setMessage("") : setMessage(res?.error || "操作失敗"));
  function makeGuestName() {
    return `玩家${Math.floor(1000 + Math.random() * 9000)}`;
  }

  function safeName() {
    const typed = Array.from((name || "").normalize("NFKC").trim()).slice(0, 16).join("");

    if (typed) {
      localStorage.setItem("kw_display_name", typed);
      return typed;
    }

    const saved = localStorage.getItem("kw_display_name");
    if (saved) return saved;

    const guest = makeGuestName();
    localStorage.setItem("kw_display_name", guest);
    setName(guest);
    return guest;
  }

  function rememberSession(pid, nextRoom) {
    if (!pid || !nextRoom?.roomCode) return;
    localStorage.setItem("kw_session", JSON.stringify({
      playerId: pid,
      roomCode: nextRoom.roomCode
    }));
  }

  function clearSavedSession() {
    localStorage.removeItem("kw_session");
  }

  function createRoom() {
    // CLIENT_CLEAR_BEFORE_CREATE_MIN_V1
    clearSavedSession();

    // CLIENT_CLEAR_SESSION_BEFORE_CREATE_V1
    clearSavedSession();

    socket.emit("room:create", { name: safeName(), maxPlayers }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "建立失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      rememberSession(res.playerId, res.room);
      setMessage("");
    });
  }

  function joinRoom() {
    // CLIENT_CLEAR_BEFORE_JOIN_MIN_V1
    clearSavedSession();

    // CLIENT_CLEAR_SESSION_BEFORE_JOIN_V1
    clearSavedSession();

    socket.emit("room:join", { name: safeName(), code: roomCodeInput }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "加入失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      rememberSession(res.playerId, res.room);
      setMessage("");
    });
  }

  function toggleReady() {
    emit("room:toggleReady");
  }

  function updateRoomSettings(nextSettings) {
    socket.emit("room:updateSettings", nextSettings, (res) => {
      if (!res?.ok) return setMessage(res?.error || "房間設定更新失敗");
      setMessage("");
    });
  }

  function addAIPlayer() {
    socket.emit("room:addAI", {}, (res) => {
      if (!res?.ok) return setMessage(res?.error || "添加機器人失敗");
      setMessage("");
    });
  }

  function removeAIPlayer() {
    socket.emit("room:removeAI", {}, (res) => {
      if (!res?.ok) return setMessage(res?.error || "刪除機器人失敗");
      setMessage("");
    });
  }

  function startSinglePlayer() {
    // CLIENT_CLEAR_BEFORE_SINGLE_MIN_V1
    clearSavedSession();

    // CLIENT_CLEAR_SESSION_BEFORE_SINGLEPLAYER_V1
    clearSavedSession();

    setMessage("正在建立單人模式...");
    socket.emit("singleplayer:start", { name: safeName() }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "單人模式建立失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      rememberSession(res.playerId, res.room);
      setMessage("");
    });
  }

  function returnToMainMenu() {
    const isPlayingNow = room?.status === "playing";

    if (isPlayingNow) {
      const ok = window.confirm("現在回到主選單會視同投降並判定失敗，確定要離開嗎？");
      if (!ok) return;
    }

    socket.emit("room:leave", {}, () => {});

    localStorage.removeItem("kw_session");
    setRoom(null);
    setPlayerId(null);
    setTargetPlayerId("");
    setAttackerId(null);
    setMagicPlan(null);
    setMessage("");
  }

  function returnHomeFromResult() {
    // CLIENT_RETURN_HOME_CLEAR_SESSION_FINAL_V1
    clearSavedSession();
    setRoom(null);
    setPlayerId(null);
    setTargetPlayerId("");
    setAttackerId(null);
    setMagicPlan(null);
    setMessage("");
  }

  function playAgainFromResult() {
    // PLAY_AGAIN_FULLY_DISABLED_CLEAN_V1
    setMessage("本局結束後會自動回到主選單。");
  }

  function startTutorialRoom() {
    // CLIENT_CLEAR_BEFORE_TUTORIAL_MIN_V1
    clearSavedSession();

    // CLIENT_CLEAR_SESSION_BEFORE_TUTORIAL_V1
    clearSavedSession();

    setMessage("正在建立操作教學房...");

    socket.emit("tutorial:start", { name: safeName() }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "無法開始操作教學");

      setPlayerId(res.playerId);
      setRoom(res.room);

      if (typeof rememberSession === "function") {
        rememberSession(res.playerId, res.room);
      }

      setMessage("操作教學：請依照畫面提示完成部署、攻擊、施法與結束回合。");
    });
  }

  function randomMatch() {
    // CLIENT_CLEAR_BEFORE_MATCH_MIN_V1
    clearSavedSession();

    // CLIENT_CLEAR_SESSION_BEFORE_MATCH_V1
    clearSavedSession();

    setMessage("正在尋找公開房間...");
    socket.emit("matchmaking:join", { name: safeName() }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "隨機匹配失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      rememberSession(res.playerId, res.room);
      setMessage(res.waiting ? "已建立公開房間，正在等待其他玩家加入..." : "已加入公開房間。");
    });
  }


  React.useEffect(() => {
    // AUTO_RETURN_HOME_AFTER_RESULT_CLEAN_V1
    if (room?.status !== "ended") return;

    const timer = window.setTimeout(() => {
      clearSavedSession();
      setRoom(null);
      setPlayerId(null);
      setTargetPlayerId("");
      setAttackerId(null);
      setMagicPlan(null);
      setMessage("本局已結束，已自動回到主選單。");
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [room?.status, room?.roomCode]);

  if (tutorialMode) {
    return <InteractiveTutorial onExit={() => setTutorialMode(false)} />;
  }

  if (!room) {
    return (
      <main className="page centered">
        <section className="card hero newHero">
          <div className="titleBadge">Online Multiplayer</div>
          <h1>國王戰爭</h1>
          <p>選擇私人房間、輸入房間代碼，或進入公開隨機匹配房間。</p>

          <label>暱稱 / 遊戲 ID</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 Wayne；不填會自動產生 ID" />
          <p className="idHint">不輸入也可以，系統會自動給你一個玩家 ID。</p>

          <div className="twoCols">
            <section className="startBox">
              <h2>創建房間</h2>
              <p>建立私人房間。只有知道房間代碼的玩家可以加入。</p>
              <button className="primaryBtn" onClick={createRoom}>創建私人房間</button>
            </section>

            <section className="startBox">
              <h2>加入房間</h2>
              <label>房間代碼</label>
              <input value={roomCodeInput} onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())} placeholder="例如 KW1234" />
              <button className="primaryBtn" onClick={joinRoom}>加入房間</button>
            </section>

            <section className="startBox matchBox">
              <h2>隨機匹配</h2>
              <p>系統會先尋找公開房間；如果沒有，就建立一個新的公開房間。公開房間也會有房間代碼。</p>
              <button className="matchBtn" onClick={randomMatch}>尋找公開房間</button>
            </section>
          </div>

          <div className="quickRules">
            <strong>遊戲目標：</strong>把其他玩家國王 HP 打到 0。<br />
            <strong>每回合：</strong>部署兵種、攻擊、使用魔法，最後結束回合。<br />
            <strong>急援：</strong>若回合開始時場上沒有兵種，第一張部署的初級或中級兵種可以立刻攻擊。
          </div>

          <button
            className="secondary openTutorialBtn"
            onClick={() => {
              startTutorialRoom();
            }}
          >
            開始操作教學
          </button>

          {message && <p className="error">{message}</p>}

          {showTutorial && (
            <TutorialModal
              step={tutorialStep}
              setStep={setTutorialStep}
              onClose={() => setShowTutorial(false)}
            />
          )}
        </section>
      </main>
    );
  }

  const me = room.players.find((p) => p.id === playerId);
  const isHost = room.hostId === playerId;
  const turnTimeLimit = Number(room.settings?.turnTimeLimit || 0);
  const turnRemaining = turnTimeLimit && room.turnStartedAt
    ? Math.max(0, turnTimeLimit - Math.floor((now - room.turnStartedAt) / 1000))
    : null;
  const allGuestsReady = room.players
    .filter((p) => p.id !== room.hostId && !p.isAI)
    .every((p) => p.ready);
  const isMyTurn = room.currentPlayerId === playerId;
  const enemies = room.players.filter((p) => p.id !== playerId && !p.eliminated);
  const targetPlayer = enemies.find((p) => p.id === targetPlayerId) || enemies[0];
  const attacker = me?.field.find((u) => u.id === attackerId);
  const magicTargetPlayer = room.players.find((p) => p.id === magicPlan?.targetPlayerId);
  const hint = actionHint({ room, me, isMyTurn, attacker, targetPlayer, magicPlan });

  const gameEnded = room.status === "ended";
  const winner = gameEnded ? room.players.find((p) => !p.eliminated && p.hp > 0) : null;
  const didWin = gameEnded && winner?.id === playerId;
  const isSingleplayerRoom = room.players.some((p) => p.isAI);

  if (room.status === "lobby") {
    return (
      <main className="page centered">
        <section className="card hero lobbyCard">
          <div className="titleBadge">{room.roomType || "房間"} Code</div>
          <h1>{room.roomCode}</h1>
          <p>{room.isPublic ? "這是公開房間。其他玩家可以透過隨機匹配或輸入房間代碼加入。" : "這是私人房間。只有知道房間代碼的玩家可以加入。"}</p>

          <div className="playerList">
            {room.players.map((p) => (
              <div key={p.id} className="playerRow">
                <strong>{p.name}</strong>
                <span>
                    {p.isAI ? "機器人" : p.isHost ? "房主" : "房客"}｜{p.isAI ? "AI" : p.connected ? "在線" : "斷線"}
                    {!p.isHost && (
                      <b className={p.ready ? "readyBadge ready" : "readyBadge waiting"}>
                        {p.ready ? "準備完成" : "準備中"}
                      </b>
                    )}
                  </span>
              </div>
            ))}
          </div>

          <p>人數：{room.players.length} / {room.maxPlayers}</p>

          {isHost && (
            <section className="hostSettingsPanel">
              <h2>房主設定</h2>

              <div className="hostSettingGrid hostSettingButtonsGrid">
                {/* HOST_SETTINGS_BUTTONS_V2 */}
                <div className="settingBlock">
                  {/* HOST_SETTINGS_BUTTON_CLICK_FIX_V1 */}
                  <span className="settingLabel">遊玩人數</span>
                  <div className="settingButtonGroup">
                    {[2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={room.maxPlayers === n ? "settingChoice active" : "settingChoice"}
                        disabled={n < room.players.length}
                        onClick={() => updateRoomSettings({ maxPlayers: n })}
                      >
                        {n} 人
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settingBlock">
                  <span className="settingLabel">每回合時間限制</span>
                  <div className="settingButtonGroup">
                    {[
                      { label: "無限制", value: 0 },
                      { label: "30 秒", value: 30 },
                      { label: "60 秒", value: 60 },
                      { label: "120 秒", value: 120 }
                    ].map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={(room.settings?.turnTimeLimit ?? 0) === item.value ? "settingChoice active" : "settingChoice"}
                        onClick={() => updateRoomSettings({ turnTimeLimit: item.value })}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="aiControlRow">
                <button
                  className="secondary"
                  onClick={addAIPlayer}
                  disabled={room.players.length >= room.maxPlayers}
                >
                  添加機器人
                </button>

                <button
                  className="dangerBtn"
                  onClick={removeAIPlayer}
                  disabled={!room.players.some((p) => p.isAI)}
                >
                  刪除機器人
                </button>
              </div>

              <p className="settingHint">
                機器人會算入遊玩人數。時間限制會在下一階段加入倒數與自動結束回合。
              </p>
            </section>
          )}

          <div className="panelActions">
            {isHost ? (
              <button
                className="primaryBtn"
                disabled={!allGuestsReady || room.players.length < 2}
                onClick={() => emit("game:start")}
              >
                {allGuestsReady ? "開始遊戲" : "等待房客準備"}
              </button>
            ) : (
              <button
                className={me?.ready ? "readyToggle ready" : "readyToggle waiting"}
                onClick={toggleReady}
              >
                {me?.ready ? "取消準備" : "我準備好了"}
              </button>
            )}
            <button className="secondary" onClick={returnToMainMenu}>回到主選單</button>
          </div>
          {message && <p className="error">{message}</p>}
        </section>
      </main>
    );
  }

  function closeCardDetailForAction() {
    setCardDetailModal(null);
  }

  function openMobileActionModal(card, source, actionText, runAction) {
    closeCardDetailForAction();

    const detail = typeof buildCardDetail === "function"
      ? buildCardDetail(card, source)
      : {
          source,
          name: card?.name || source,
          rank: card?.rank || card?.level || "",
          type: card?.type || "",
          text: card?.text || card?.effect || "",
          power: typeof effectivePower === "function" && card?.kind !== "magic" ? effectivePower(card) : null,
          status: card?.status || []
        };

    setMobileActionModal({
      detail,
      actionText,
      runAction
    });
  }

  function attackUnit(defenderId) {
    closeCardDetailForAction();
    if (!attackerId || !targetPlayer) return setMessage("請先選擇攻擊者和目標玩家。");
    emit("game:attackUnit", { attackerId, targetPlayerId: targetPlayer.id, defenderId });
    setAttackerId(null);
  }

  function attackKing() {
    closeCardDetailForAction();
    if (!attackerId || !targetPlayer) return setMessage("請先選擇攻擊者和目標玩家。");
    emit("game:attackKing", { attackerId, targetPlayerId: targetPlayer.id });
    setAttackerId(null);
  }

  function handleEndTurn() {
    closeCardDetailForAction();
    if (!isMyTurn) return;

    const readyUnits = me?.field?.filter(canUnitStillAct) || [];

    if (readyUnits.length > 0) {
      const names = readyUnits.map((u) => u.name).join("、");
      const ok = window.confirm(
        `你還有 ${readyUnits.length} 名兵種尚未行動：${names}\n\n確定要結束回合嗎？`
      );

      if (!ok) return;
    }

    setAttackerId(null);
    setMagicPlan(null);
    emit("game:endTurn");
  }

  function beginMagic(magic) {
    closeCardDetailForAction();
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
    closeCardDetailForAction();
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
    closeCardDetailForAction();
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
    closeCardDetailForAction();
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
    closeCardDetailForAction();
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
    closeCardDetailForAction();
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

    setMessage("施法確認中...");

    socket.emit("game:castMagic", {
      magicId: magicPlan.magic.id,
      casterId: magicPlan.casterId,
      targetPlayerId: magicPlan.targetPlayerId,
      targetUnitIds: magicPlan.targetUnitIds
    }, (res) => {
      if (!res?.ok) {
        setMessage(res?.error || "施法失敗，請重新確認施法者與目標。");
        return;
      }

      setMessage("");
      setMagicPlan(null);
    });
  }

  function selectOwnUnit(card) {
    closeCardDetailForAction();
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
          {turnRemaining !== null && (
            <div className={turnRemaining <= 10 ? "turnTimer danger" : "turnTimer"}>
              回合倒數：{turnRemaining} 秒
            </div>
          )}
        </div>

        <div className="topActions">
          <button className="secondary" onClick={() => setShowHelp((v) => !v)}>{showHelp ? "隱藏提示" : "顯示提示"}</button>
          <button className="secondary" onClick={() => setShowRulesModal(true)}>規則</button>
          <button className="secondary" onClick={() => setShowLogModal(true)}>紀錄</button>
          <button className="secondary" onClick={returnToMainMenu}>回到主選單</button>
          <button className="endTurnBtn" disabled={!isMyTurn} onClick={handleEndTurn}>結束回合</button>
        </div>
      </header>

      {message && <p className="error floatingError">{message}</p>}

      {mobileActionModal && (
        <section className="mobileActionOverlay" onClick={() => setMobileActionModal(null)}>
          <div className="mobileActionPanel" onClick={(e) => e.stopPropagation()}>
            <div className="mobileActionTop">
              <span>{mobileActionModal.detail?.source || "ACTION"}</span>
              <button className="secondary" onClick={() => setMobileActionModal(null)}>關閉</button>
            </div>

            <h2>{mobileActionModal.detail?.name}</h2>

            <div className="mobileActionMeta">
              {mobileActionModal.detail?.rank && <b>{mobileActionModal.detail.rank}</b>}
              {mobileActionModal.detail?.type && <b>{mobileActionModal.detail.type}</b>}
              {mobileActionModal.detail?.power !== null && mobileActionModal.detail?.power !== undefined && (
                <b>戰力 {mobileActionModal.detail.power}</b>
              )}
            </div>

            {mobileActionModal.detail?.status?.length > 0 && (
              <div className="mobileActionStatus">
                {mobileActionModal.detail.status.map((s, index) => (
                  <span key={index}>{typeof displayStatusLabel === "function" ? displayStatusLabel(s) : s}</span>
                ))}
              </div>
            )}

            <p>{mobileActionModal.detail?.text || "確認要執行這個動作嗎？"}</p>

            <div className="mobileActionButtons">
              <button
                className="primaryBtn"
                onClick={() => {
                  mobileActionModal.runAction?.();
                  setMobileActionModal(null);
                }}
              >
                {mobileActionModal.actionText || "確認"}
              </button>

              <button className="secondary" onClick={() => setMobileActionModal(null)}>
                取消
              </button>
            </div>
          </div>
        </section>
      )}

      {showRulesModal && (
        <section className="rulesLogOverlay" onClick={() => setShowRulesModal(false)}>
          <div className="rulesLogPanel" onClick={(e) => e.stopPropagation()}>
            <div className="rulesLogTop">
              <span>RULES</span>
              <button className="secondary" onClick={() => setShowRulesModal(false)}>關閉</button>
            </div>

            <h2>兵種相剋與基本規則</h2>

            <div className="rulesGrid">
              <div className="ruleBlock">
                <h3>兵種效果速查</h3>
                <p><strong>步兵：</strong>守衛。敵方有步兵時，通常必須先處理步兵，不能直接攻擊國王。</p>
                <p><strong>弓兵：</strong>遠射。依戰力差與攻擊對象，可能獲得額外攻擊或保命效果。</p>
                <p><strong>法師：</strong>施法。使用魔法卡需要選擇法師作為施法者。</p>
                <p><strong>騎兵：</strong>突擊。部署後可更快投入攻擊，是主動進攻型兵種。</p>
              </div>
              <div className="ruleBlock">
                <h3>兵種相剋</h3>
                <p>步兵 → 弓兵</p>
                <p>弓兵 → 法師</p>
                <p>法師 → 騎兵</p>
                <p>騎兵 → 步兵</p>
              </div>

              <div className="ruleBlock">
                <h3>戰鬥目標</h3>
                <p>把其他玩家的國王 HP 降到 0。</p>
                <p>敵方場上有步兵時，通常必須先處理步兵，不能直接攻擊國王。</p>
              </div>

              <div className="ruleBlock">
                <h3>回合流程</h3>
                <p>部署兵種 → 選擇攻擊者 → 攻擊兵種或國王 → 使用魔法 → 結束回合。</p>
              </div>

              <div className="ruleBlock">
                <h3>卡片說明</h3>
                <p>手機長按卡片、電腦右鍵或雙擊卡片，可以查看完整描述。</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {showLogModal && (
        <section className="rulesLogOverlay" onClick={() => setShowLogModal(false)}>
          <div className="rulesLogPanel logPanelLarge" onClick={(e) => e.stopPropagation()}>
            <div className="rulesLogTop">
              <span>BATTLE LOG</span>
              <button className="secondary" onClick={() => setShowLogModal(false)}>關閉</button>
            </div>

            <h2>遊戲紀錄</h2>

            <div className="modalLogList">
              {[...(room?.log || [])].reverse().map((item, index) => (
                <div key={index}>{item}</div>
              ))}
            </div>
          </div>
        </section>
      )}

      {actionCardModal && (
        <section className="actionCardOverlay" onClick={() => setActionCardModal(null)}>
          <div className="actionCardPanel" onClick={(e) => e.stopPropagation()}>
            <div className="cardDetailTop">
              <span>{actionCardModal.detail.source}</span>
              <button className="secondary" onClick={() => setActionCardModal(null)}>關閉</button>
            </div>

            <h2>{actionCardModal.detail.name}</h2>

            <div className="cardDetailMeta">
              {actionCardModal.detail.rank && <b>{actionCardModal.detail.rank}</b>}
              {actionCardModal.detail.type && <b>{actionCardModal.detail.type}</b>}
              {actionCardModal.detail.power !== null && <b>目前戰力 {actionCardModal.detail.power}</b>}
            </div>

            <p>{actionCardModal.detail.text}</p>

            <div className="actionCardButtons">
              <button
                className="primaryBtn"
                onClick={() => {
                  actionCardModal.runAction?.();
                  setActionCardModal(null);
                }}
              >
                {actionCardModal.actionText}
              </button>

              <button
                className="secondary"
                onClick={() => {
                  setCardDetailModal(actionCardModal.detail);
                  setActionCardModal(null);
                }}
              >
                查看完整說明
              </button>
            </div>
          </div>
        </section>
      )}

      {cardDetailModal && (
        <section className="cardDetailOverlay" onClick={() => setCardDetailModal(null)}>
          <div className="cardDetailPanel" onClick={(e) => e.stopPropagation()}>
            <div className="cardDetailTop">
              <span>{cardDetailModal.source}</span>
              <button className="secondary" onClick={() => setCardDetailModal(null)}>關閉</button>
            </div>

            <h2>{cardDetailModal.name}</h2>

            <div className="cardDetailMeta">
              {cardDetailModal.rank && <b>{cardDetailModal.rank}</b>}
              {cardDetailModal.type && <b>{cardDetailModal.type}</b>}
              {cardDetailModal.power !== null && <b>目前戰力 {cardDetailModal.power}</b>}
            </div>

            {cardDetailModal.status?.length > 0 && (
              <div className="cardDetailStatus">
                {cardDetailModal.status.map((s, index) => (
                  <span key={index}>{displayStatusLabel ? displayStatusLabel(s) : s}</span>
                ))}
              </div>
            )}

            <p>{cardDetailModal.text}</p>

            <small>提示：手機長按卡片、電腦右鍵或雙擊卡片，可以再次查看完整說明。</small>
          </div>
        </section>
      )}

      {room?.tutorial && (
        <div className="formalTutorialNotice">
          <strong>操作教學：</strong>
          依序完成：部署中級騎兵 → 選擇中級騎兵 → 攻擊敵方初級弓兵 → 使用力量術 → 選初級法師 → 選我方中級騎兵 → 確認施放 → 結束回合。
        </div>
      )}

      {attackFeedback && (
        <div className="attackFeedbackToast">
          <span>⚔️</span>
          <strong>{attackFeedback}</strong>
        </div>
      )}

      {isMyTurn && me?.reinforcementAvailable && !me?.reinforcementUsed && (
        <div className="reinforcementNotice">
          急援可用：本回合第一張部署的初級或中級兵種可以立刻攻擊。
        </div>
      )}

      {turnOrderNotice && (
        <section className="turnOrderOverlay">
          <div className="turnOrderModal">
            <div className="turnOrderBadge">本局出手順序</div>
            <h2>你是第 {turnOrderNotice.myOrder} 位出手</h2>
            <p>先手玩家：{turnOrderNotice.firstPlayerName}</p>
            <div className="turnOrderPath">{turnOrderNotice.orderText}</div>
            <small>3 秒後自動關閉</small>
          </div>
        </section>
      )}

      {gameEnded && (
        <section className="resultOverlay">
          <div className={`resultModal ${didWin ? "win" : "lose"}`}>
            <div className="resultBadge">{didWin ? "VICTORY" : "DEFEAT"}</div>
            <h2>{didWin ? "勝利！" : "失敗..."}</h2>
            <p>
              {winner
                ? `本局勝利者：${winner.name}`
                : "本局已結束。"}
            </p>
            <p className="resultHint">
              {didWin
                ? "你成功擊敗了對手的國王。"
                : "你的國王被擊敗了，再調整策略試一次。"}
            </p>
            <p className="resultHint">
              結果畫面將停留 5 秒，之後自動回到主選單。
            </p>
          </div>
        </section>
      )}

      {showHelp && !gameEnded && <GuidePanel hint={hint} />}

      <section className="gfEnemyPlayers">
        {enemies.map((p) => (
          <PlayerSummary
            key={p.id}
            player={p}
            isMe={false}
            isCurrent={p.id === room.currentPlayerId}
            onDetail={openCardDetail}
          />
        ))}
      </section>

      <section className="gfMyPlayer">
        {me && (
          <PlayerSummary
            player={me}
            isMe
            isCurrent={me.id === room.currentPlayerId}
            onDetail={openCardDetail}
          />
        )}
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
                <UnitCard onDetail={openCardDetail}
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
                  <UnitCard onDetail={openCardDetail}
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
                      <UnitCard onDetail={openCardDetail}
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
                  <button className="secondary" onClick={() => {
                    closeCardDetailForAction();
                    setMagicPlan(null);
                  }}>取消</button>
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
                      <UnitCard onDetail={openCardDetail}
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
                  <button className="secondary" onClick={() => {
                    closeCardDetailForAction();
                    setMagicPlan(null);
                  }}>取消</button>
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
                  <button className="secondary" onClick={() => {
                    closeCardDetailForAction();
                    setMagicPlan(null);
                  }}>取消</button>
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
                <button
                  key={card.id}
                  className="gameCard unit handCard"
                  disabled={!isMyTurn || !!magicPlan}
                  onClick={() => openMobileActionModal(card, "兵種手牌", "部署這張兵種", () => emit("game:deploy", { cardId: card.id }))}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    openCardDetail(card, "兵種手牌");
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openCardDetail(card, "兵種手牌");
                  }}
                  onMouseDown={() => startCardDetailPress(card, "兵種手牌")}
                  onMouseUp={cancelCardDetailPress}
                  onMouseLeave={cancelCardDetailPress}
                  onTouchStart={() => startCardDetailPress(card, "兵種手牌")}
                  onTouchEnd={cancelCardDetailPress}
                >
                  <CardArt card={card} />
                  <strong>{card.name}</strong>
                  <span>傷害 {card.damage}｜剋 {card.counterTarget}</span>
                  <span className="powerText">目前戰力：{effectivePower(card)}</span>
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
              {me?.magic?.length ? me.magic.map((card) => <MagicCard onDetail={openCardDetail} key={card.id} card={card} disabled={!isMyTurn || !!magicPlan} onClick={() => openMobileActionModal(card, "魔法卡", "使用這張魔法", () => beginMagic(card))} />) : <EmptyState>沒有魔法卡。場上有法師時，回合開始會抽魔法。</EmptyState>}
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


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
