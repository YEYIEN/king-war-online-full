import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./style.css";
import "./design-system.css";

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
  if (statuses.includes("階級-1") || statuses.includes("戰力-1")) value -= 1;
  if (statuses.includes("階級+1") || statuses.includes("戰力+1")) value += 1;
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

  if (room.openingTruceActive) {
    return { tone: "neutral", title: "戰前部署期：先建立防線", steps: [
      "所有玩家先完成一回合部署；暫時不能攻擊或對敵方施放魔法。",
      "請決定哪些兵種守護國王、哪些兵種準備第二回合進攻。",
      "完成部署後按「結束回合」，全員部署後正式交戰。"
    ] };
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

const GUIDED_LESSONS = [
  {
    title: "第一關｜先部署可立即行動的騎兵",
    purpose: "我方握有中級騎兵，敵方有中級弓兵。先觀察雙方戰力：都是 2。",
    action: "點選下方「中級騎兵」並部署。",
    why: "一般兵種剛部署不能攻擊；騎兵可以。部署只是建立可用的進攻選項。",
    warning: "雙方戰力相同時，直接互相攻擊通常會兩敗俱傷。先別急著出手。"
  },
  {
    title: "第二關｜運用魔法改變戰鬥結果",
    purpose: "剛才的騎兵戰力為 2，敵方弓兵也是 2。此時直接攻擊會犧牲騎兵。",
    action: "點選「力量術」→ 選初級法師 → 選中級騎兵 → 確認施放。",
    why: "力量術讓騎兵戰力從 2 變成 3，才能在這次戰鬥中存活並消滅敵人。",
    warning: "施法會消耗法師一次行動，因此應挑選能真正改變結果的目標。"
  },
  {
    title: "第三關｜檢查剋制與損失再進攻",
    purpose: "現在騎兵戰力 3、弓兵戰力 2；騎兵並不剋制弓兵，但戰力已足以獲勝。",
    action: "選擇我方中級騎兵，再選敵方中級弓兵進行攻擊。",
    why: "戰力相等兩敗俱傷；戰力較高的一方獲勝，部分兵種還有特殊保護效果。",
    warning: "也要檢查敵方步兵：只要對方有步兵存活，就不能直接攻擊國王。"
  },
  {
    title: "第四關｜決定何時結束回合",
    purpose: "你已經成功利用資源改變原本勢均力敵的戰局，並消滅對手的兵種。",
    action: "按上方的「結束回合」。",
    why: "每一回合要權衡部署、魔法與攻擊的先後，而不是看到可以按就立刻按。",
    warning: "正式遊戲的目標，是清除敵方步兵防線，再將國王 HP 降到 0。"
  }
];

const TUTORIAL_RECALL_QUESTIONS = [
  {
    prompt: "剛部署的中級騎兵面對同戰力的弓兵，為什麼先用力量術？",
    options: [
      "因為騎兵剛部署完全不能行動",
      "讓戰力從 2 提升到 3，避免直接交換造成的損失",
      "因為弓兵只能被魔法直接消滅"
    ],
    correct: 1,
    explanation: "騎兵可以立即攻擊，但要先考慮戰力相等時的交換結果。力量術能使這次交換更有利。"
  },
  {
    prompt: "敵方場上還有步兵守衛時，你能直接攻擊國王嗎？",
    options: [
      "不行，必須先處理敵方步兵防線",
      "可以，只要我方有騎兵",
      "可以，只要國王 HP 低於 10"
    ],
    correct: 0,
    explanation: "步兵是國王的守衛。先清除步兵，才能依照規則攻擊國王。"
  },
  {
    prompt: "你手上有魔法卡，但場上沒有可以施法的法師時，應該怎麼做？",
    options: [
      "直接選魔法卡就能施放",
      "由任意弓兵代替施法",
      "先部署或準備能合法施法的法師，不能跳過施法者條件"
    ],
    correct: 2,
    explanation: "魔法需要可行動的法師；施法也會消耗法師一次行動。"
  }
];

function GuidedTutorialCoach({ progress = 0, onExit }) {
  const [questionIndex, setQuestionIndex] = React.useState(0);
  const [answer, setAnswer] = React.useState(null);
  const index = Math.min(progress, GUIDED_LESSONS.length - 1);
  const lesson = GUIDED_LESSONS[index];
  const complete = progress >= GUIDED_LESSONS.length;
  const question = TUTORIAL_RECALL_QUESTIONS[questionIndex];
  const correct = answer === question.correct;
  function nextQuestion() {
    setQuestionIndex((current) => Math.min(current + 1, TUTORIAL_RECALL_QUESTIONS.length - 1));
    setAnswer(null);
  }

  return (
    <section className="guidedLesson" aria-label="互動新手實戰教學">
      <div className="guidedLessonTop">
        <strong>實戰教學 · {complete ? "理解驗收" : `任務 ${progress + 1}/${GUIDED_LESSONS.length}`}</strong>
        <span>{complete ? `情境確認 ${questionIndex + 1}/${TUTORIAL_RECALL_QUESTIONS.length}` : "請親自操作正式遊戲卡牌"}</span>
      </div>
      {complete ? (
        <>
          <h2>實戰回合完成！確認你理解關鍵規則</h2>
          <p className="lessonTask">{question.prompt}</p>
          <div className="lessonChoiceGroup" role="group" aria-label={`情境理解題 ${questionIndex + 1}`}>
            {question.options.map((choice, i) => (
              <button type="button" key={choice}
                aria-pressed={answer === i}
                className={answer === i ? "selected" : "secondary"}
                onClick={() => setAnswer(i)}>{choice}</button>
            ))}
          </div>
          {answer !== null && (
            <p role="status" aria-live="polite" className={correct ? "lessonCorrect" : "lessonWrong"}>
              {correct ? "判斷正確。" : "這個選擇可能導致不利行動，請重新選擇。"} {question.explanation}
            </p>
          )}
          {correct && (questionIndex === TUTORIAL_RECALL_QUESTIONS.length - 1
            ? <button type="button" className="primaryBtn" onClick={onExit}>完成理解驗收，返回主選單</button>
            : <button type="button" className="primaryBtn" onClick={nextQuestion}>下一個情境</button>)}
          <p className="lessonAssessmentNote">這是即時理解確認，不代表已掌握獨立對戰策略。進入正式對局後仍可查閱規則。</p>
        </>
      ) : (
        <>
          <h2>{lesson.title}</h2>
          <p><strong>局勢：</strong>{lesson.purpose}</p>
          <p className="lessonTask"><strong>現在請做：</strong>{lesson.action}</p>
          <p><strong>為什麼：</strong>{lesson.why}</p>
          <p className="lessonWarning"><strong>策略提醒：</strong>{lesson.warning}</p>
          <div className="lessonProgress" aria-label={`已完成 ${progress} 個實戰操作`}>
            {GUIDED_LESSONS.map((_, i) => <span key={i} className={i <= progress ? "active" : ""} />)}
          </div>
        </>
      )}
    </section>
  );
}

function App() {
  const socket = useMemo(() => io(SERVER_URL), []);
  const [name, setName] = useState("");
  const [aiDifficulty, setAiDifficulty] = useState("normal");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [playerId, setPlayerId] = useState(null);
  const [room, setRoom] = useState(null);
  const [message, setMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState(socket.connected ? "connected" : "connecting");
  const pendingRequestsRef = useRef(new Set());
  const [targetPlayerId, setTargetPlayerId] = useState("");
  const [attackerId, setAttackerId] = useState(null);
  const [magicPlan, setMagicPlan] = useState(null);
  const [showHelp, setShowHelp] = useState(true);
  const [cardDetailModal, setCardDetailModal] = useState(null);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [mobileActionModal, setMobileActionModal] = useState(null);
  const [actionCardModal, setActionCardModal] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [attackFeedback, setAttackFeedback] = useState(null);
  const lastLogRef = useRef("");
  const [turnOrderNotice, setTurnOrderNotice] = useState(null);
  const previousRoomStatusRef = useRef(null);
  const cardDetailPressTimerRef = useRef(null);

  function openCardDetail(card, source = "卡片") {
    // Unit rules remain on their cards and in the rules reference; prevent accidental long-press overlays.
    if (shouldBlockUnitCardDetail(card, source)) return;
    const detail = buildCardDetail(card, source);
    if (detail) setCardDetailModal(detail);
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
    const connected = () => setConnectionStatus("connected");
    const disconnected = () => setConnectionStatus("disconnected");
    const connectionError = () => setConnectionStatus("disconnected");
    socket.on("connect", connected);
    socket.on("disconnect", disconnected);
    socket.on("connect_error", connectionError);
    return () => {
      socket.off("connect", connected);
      socket.off("disconnect", disconnected);
      socket.off("connect_error", connectionError);
    };
  }, [socket]);

  React.useEffect(() => {
    // kw_session_resume
    function resumeSession() {
      const raw = localStorage.getItem("kw_session");
      if (!raw) return;

      try {
        const saved = JSON.parse(raw);
        if (!saved?.roomCode || !saved?.playerId || !saved?.resumeToken) {
          localStorage.removeItem("kw_session");
          return;
        }

        requestNow("room:resume", saved, (res) => {
          if (!res?.ok) {
            localStorage.removeItem("kw_session");
            setRoom(null);
            setPlayerId(null);
            setTargetPlayerId("");
            setAttackerId(null);
            setMagicPlan(null);
            setMessage(res?.error || "連線已恢復，但原房間無法接續。請重新加入。");
            return;
          }
          rememberSession(res.playerId, res.room, res.resumeToken);
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

  // Single unbuffered transport path for lobby, room and gameplay commands.
  function requestNow(event, data, callback) {
    if (!socket.connected) {
      setMessage("目前離線，操作未送出。請待連線恢復後重新確認局勢再操作。");
      return false;
    }
    if (pendingRequestsRef.current.has(event)) {
      setMessage("同類操作仍在等候伺服器確認，請勿重複送出。");
      return false;
    }
    pendingRequestsRef.current.add(event);
    // Acknowledged, bounded requests avoid offline buffers and duplicate double-clicks.
    socket.timeout(5000).emit(event, data, (error, response) => {
      pendingRequestsRef.current.delete(event);
      if (error) {
        const failure = {ok:false,error:"伺服器未在 5 秒內確認操作，請檢查目前局勢後再試。"};
        callback?.(failure);
        return;
      }
      callback?.(response);
    });
    return true;
  }

  // Socket.IO normally buffers emits while offline; never replay an old game move on reconnect.
  const emit = (event, data = {}) => {
    if (!socket.connected) {
      setMessage("目前離線，操作未送出。請待連線恢復後重新確認局勢再操作。");
      return;
    }
    requestNow(event, data, (res) => res?.ok ? setMessage("") : setMessage(res?.error || "操作失敗"));
  };
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

  function rememberSession(pid, nextRoom, resumeToken) {
    if (!pid || !nextRoom?.roomCode || !resumeToken) return;
    localStorage.setItem("kw_session", JSON.stringify({
      playerId: pid,
      roomCode: nextRoom.roomCode,
      resumeToken
    }));
  }

  function clearSavedSession() {
    localStorage.removeItem("kw_session");
  }

  function createRoom() {
    clearSavedSession();

    requestNow("room:create", { name: safeName(), maxPlayers }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "建立失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      rememberSession(res.playerId, res.room, res.resumeToken);
      setMessage("");
    });
  }

  function joinRoom() {
    clearSavedSession();

    requestNow("room:join", { name: safeName(), code: roomCodeInput }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "加入失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      rememberSession(res.playerId, res.room, res.resumeToken);
      setMessage("");
    });
  }

  function toggleReady() {
    emit("room:toggleReady");
  }

  function updateRoomSettings(nextSettings) {
    requestNow("room:updateSettings", nextSettings, (res) => {
      if (!res?.ok) return setMessage(res?.error || "房間設定更新失敗");
      setMessage("");
    });
  }

  function addAIPlayer() {
    requestNow("room:addAI", {}, (res) => {
      if (!res?.ok) return setMessage(res?.error || "添加機器人失敗");
      setMessage("");
    });
  }

  function removeAIPlayer() {
    requestNow("room:removeAI", {}, (res) => {
      if (!res?.ok) return setMessage(res?.error || "刪除機器人失敗");
      setMessage("");
    });
  }

  function startSinglePlayer() {
    clearSavedSession();

    setMessage("正在建立單人模式...");
    requestNow("singleplayer:start", { name: safeName(), difficulty: aiDifficulty }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "單人模式建立失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      rememberSession(res.playerId, res.room, res.resumeToken);
      setMessage("");
    });
  }

  function returnToMainMenu() {
    const isPlayingNow = room?.status === "playing";

    if (isPlayingNow) {
      const ok = window.confirm("現在回到主選單會視同投降並判定失敗，確定要離開嗎？");
      if (!ok) return;
    }

    requestNow("room:leave", {}, () => {});

    localStorage.removeItem("kw_session");
    setRoom(null);
    setPlayerId(null);
    setTargetPlayerId("");
    setAttackerId(null);
    setMagicPlan(null);
    setMessage("");
  }

  function returnHomeFromResult() {
    // Let the server release this participant when leaving the finished result screen.
    requestNow("room:leave", {}, () => {});
    clearSavedSession();
    setRoom(null);
    setPlayerId(null);
    setTargetPlayerId("");
    setAttackerId(null);
    setMagicPlan(null);
    setMessage("");
  }

  function startTutorialRoom() {
    clearSavedSession();

    setMessage("正在建立操作教學房...");

    requestNow("tutorial:start", { name: safeName() }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "無法開始操作教學");

      setPlayerId(res.playerId);
      setRoom(res.room);

      if (typeof rememberSession === "function") {
        rememberSession(res.playerId, res.room, res.resumeToken);
      }

      setMessage("操作教學：請依照畫面提示完成部署、攻擊、施法與結束回合。");
    });
  }

  function randomMatch() {
    clearSavedSession();

    setMessage("正在尋找公開房間...");
    requestNow("matchmaking:join", { name: safeName() }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "隨機匹配失敗");
      setPlayerId(res.playerId);
      setRoom(res.room);
      rememberSession(res.playerId, res.room, res.resumeToken);
      setMessage(res.waiting ? "已建立公開房間，正在等待其他玩家加入..." : "已加入公開房間。");
    });
  }


  // Keep the completed match visible until the player explicitly leaves.
  // The server retains control over room cleanup and may notify clients if the room expires.

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

            <section className="startBox aiStartBox">
              <h2>單人挑戰｜電腦對手</h2>
              <p className="settingHint">選擇對手難度，遊戲操作與規則保持一致。</p>
              <p>先選擇電腦難度，也可在多人房間加入 AI。</p>
              <div className="settingButtonGroup">
                {[["easy","簡單"],["normal","中等"],["hard","困難"],["conqueror","征服者（研究型）"]].map(([id,label]) => (
                  <button type="button" key={id} className={aiDifficulty === id ? "settingChoice active" : "settingChoice"}
                    onClick={() => setAiDifficulty(id)}>{label}</button>
                ))}
              </div>
              <button className="primaryBtn" onClick={startSinglePlayer}>開始單人對戰</button>
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
            <strong>急援：</strong>若回合開始時場上沒有兵種，第一張部署的初級或中級兵種可以立刻攻擊。<br />
            <strong>背水一戰：</strong>嚴重落後時每局一次，耗費2HP，選擇「突圍」（2張兵種＋緊急部署＋3點護盾）或「固守」（1張兵種＋7點護盾）。
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

              <div className="settingBlock">
                <span className="settingLabel">電腦難度（所有 AI 玩家共用）</span>
                <div className="settingButtonGroup">
                  {[["easy","簡單"],["normal","中等"],["hard","困難"],["conqueror","征服者"]].map(([id,label]) => (
                    <button type="button" key={id} className={(room.settings?.aiDifficulty || "normal") === id ? "settingChoice active" : "settingChoice"}
                      onClick={() => updateRoomSettings({ aiDifficulty: id })}>{label}</button>
                  ))}
                </div>
              </div>
              {room.maxPlayers === 2 && (
                <div className="settingBlock">
                  <span className="settingLabel">雙人公平開局（實驗規則）</span>
                  <p className="settingHint">開啟後先手首回合只能部署與準備，不能進攻；後手開局多抽1張兵種。關閉則沿用原規則。</p>
                  <div className="settingButtonGroup">
                    <button type="button" className={room.settings?.firstSeatPeacefulTurn ? "settingChoice active" : "settingChoice"}
                      onClick={() => updateRoomSettings({ fairOpening2P: true })}>開啟試玩</button>
                    <button type="button" className={!room.settings?.firstSeatPeacefulTurn ? "settingChoice active" : "settingChoice"}
                      onClick={() => updateRoomSettings({ fairOpening2P: false })}>原規則</button>
                  </div>
                </div>
              )}
              <div className="settingBlock">
                <span className="settingLabel">背水一戰（逆轉機制）</span>
                <div className="settingButtonGroup">
                  <button type="button" className={room.settings?.comebackEnabled !== false ? "settingChoice active" : "settingChoice"}
                    onClick={() => updateRoomSettings({ comebackEnabled: true })}>開啟</button>
                  <button type="button" className={room.settings?.comebackEnabled === false ? "settingChoice active" : "settingChoice"}
                    onClick={() => updateRoomSettings({ comebackEnabled: false })}>關閉</button>
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

    const detail = buildCardDetail(card, source);

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

    requestNow("game:castMagic", {
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
          {me?.comebackAvailable && isMyTurn && (
            <div className="lastStandChoices" role="group" aria-label="背水一戰策略">
              <button className="secondary lastStandButton" onClick={() => {
                if (window.confirm("突圍：每局一次、消耗2HP，抽2張兵種、緊急部署一次、獲得3點臨時國王護盾。確定嗎？")) {
                  emit("game:lastStand", { mode: "assault" });
                }
              }}>背水突圍（-2HP）</button>
              <button className="secondary lastStandButton" onClick={() => {
                if (window.confirm("固守：每局一次、消耗2HP，抽1張兵種、獲得7點臨時國王護盾；不會額外獲得緊急部署。確定嗎？")) {
                  emit("game:lastStand", { mode: "defense" });
                }
              }}>堅守反擊（-2HP）</button>
            </div>
          )}
          <button className="endTurnBtn" disabled={!isMyTurn} onClick={handleEndTurn}>結束回合</button>
        </div>
      </header>

      {connectionStatus !== "connected" && (
        <p className="connectionWarning" role="status" aria-live="polite">
          <strong>連線中斷或尚未建立。</strong> 目前操作不會被排隊送出，請在恢復後確認戰場狀態。
        </p>
      )}
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
                <p>部署兵種、攻擊與施法可視局勢排序，再結束回合。</p>
                <p><strong>背水一戰：</strong>HP 不高於 12、場上最多2兵種，而且敵方確實具有明顯優勢時，每局一次可付出2HP，在突圍（多抽牌、立即部署）及固守（較高護盾）間選擇一次，並消耗2HP；房主可關閉。</p>
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

            <small>提示：國王及魔法卡可長按或右鍵查看說明；兵種效果請查看卡面及規則頁。</small>
          </div>
        </section>
      )}

      {room.openingTruceActive && (
        <section className="guidedLesson">
          <h2>戰前部署期間</h2>
          <p>所有玩家先完成一次布陣；本輪禁止攻擊及對敵方使用魔法。請先決定自己的兵種防線。</p>
        </section>
      )}
      {room?.tutorial && <GuidedTutorialCoach key={room.roomCode} progress={room.tutorialProgress || 0} onExit={returnToMainMenu} />}

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
              你可以查看本局結果，準備好後再返回主選單。
            </p>
            <button type="button" className="primaryBtn" onClick={returnHomeFromResult}>返回主選單</button>
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
        <select aria-label="選擇目標玩家" value={targetPlayer?.id || ""} onChange={(e) => setTargetPlayerId(e.target.value)}>
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
