import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./style.css";
import "./design-system.css";
import "./combat-v3.css";

import { supabase, loadAccount, ensurePlayerProfile } from "./account.js";
import { createPerformanceDiagnostics } from "./performance-diagnostics.js";

const performanceDiagnostics = typeof window !== "undefined" ? createPerformanceDiagnostics(window) : null;
if (performanceDiagnostics) window.__KW_PERF__ = performanceDiagnostics;

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);
const ASSET_BASE = "/king-war-assets";

function cardImage(card) {
  if (!card?.name) return "";
  return `${ASSET_BASE}/cards/${card.name}_63x88mm_300dpi.png`;
}

const CardArt = React.memo(function CardArt({ card, small = false }) {
  const src = cardImage(card);
  if (!src) return null;
  return <img className={small ? "cardArt small" : "cardArt"} src={src} alt={card.name}
    loading="lazy" decoding="async" draggable={false}
    onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}, (previous, next) => previous.small === next.small && cardImage(previous.card) === cardImage(next.card));

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

function canUnitStillAct(card) {
  if (!card || card.tapped) return false;
  const status = card.status || [];
  return !["整備", "不能攻擊", "疲乏", "疲乏待解"].some(flag => status.includes(flag));
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
    steps: ["你可以部署任意數量兵種，直到場上滿 5 張。", "你可以點選可行動兵種作為攻擊者。", "你可以點選魔法卡，依提示選法師與目標。", "行動完成後，按「結束回合」。"],
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

function UnitCard({ card, onClick, selected, disabled, actionLabel, compact = false, highlight = "", onDetail }) {
  return (
    <div className="kwUnitCardShell">
      <button
        className={`gameCard unit ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${highlight}`}
        disabled={disabled}
        onClick={onClick}
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
      {onDetail && (
        <button type="button" className="kwUnitInfo"
          aria-label={`查看${card.name}的完整能力`}
          title="查看兵種效果" onClick={()=>onDetail(card,"兵種",true)}>i</button>
      )}
    </div>
  );
}

function MagicCard({ card, onClick, disabled, selected, onDetail, onAction, hiddenMobile = false }) {
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
      className={`gameCard magic ${selected ? "selected" : ""} ${hiddenMobile ? "mobileHandHidden" : ""}`}
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
  { title:"部署第一名兵種", where:"#kw-hand", location:"手牌與部署",
    purpose:"先把兵種放上戰場，才可以參與戰鬥。",
    action:"點手牌中的「中級騎兵」，確認部署。",
    why:"騎兵能在部署當回合進攻；其他兵種通常要等待下一回合。", warning:"先別攻擊，下一步會用魔法強化它。" },
  { title:"用法師施放力量術", where:"#kw-hand", location:"魔法卡",
    purpose:"場上已放好法師，手上有一張力量術。魔法需要法師，並消耗法師本回合的行動。",
    action:"點「力量術」，選初級法師，再選我方中級騎兵。",
    why:"騎兵原戰力 2，強化後變 3，能避免在對決中與戰力 2 的弓兵同歸於盡。",
    warning:"施法的法師本回合不能再次攻擊。魔法介面每一步都可取消。" },
  { title:"選攻擊者，再選敵方兵種", where:"#kw-field", location:"我方與敵方戰場",
    purpose:"騎兵已獲得力量術加成，現在親自用它擊敗敵方中級弓兵。",
    action:"選我方中級騎兵，攻擊敵方中級弓兵。",
    why:"攻擊時比較雙方戰力，還要考慮兵種相剋與特殊能力。",
    warning:"攻擊一次通常消耗一次行動，已行動的兵種不可重複出手。" },
  { title:"直接攻擊敵方國王", where:"#kw-enemy", location:"敵方戰場",
    purpose:"敵人場上已沒有步兵守衛。你可以看見敵方 HP 和國王能力。",
    action:"選初級騎兵，點「攻擊敵方國王」。",
    why:"戰鬥的最終目標是把敵方國王 HP 降至 0；有步兵守衛時必須先清除步兵。",
    warning:"可以直接點國王名稱查看王權，點「規則」查看兵種相剋。" },
  { title:"結束第一個回合", where:"#kw-top-actions", location:"回合操作區",
    purpose:"你已部署、施法、攻擊兵種和國王。現在體驗回合結束與下一回合抽牌。",
    action:"點「結束回合」，看看對手如何布防。",
    why:"回合開始會抽兵種牌；有法師時也可能抽魔法。每回合須決定資源使用順序。",
    warning:"結束回合後，將輪到對手。" },
  { title:"先部署步兵保護國王", where:"#kw-hand", location:"手牌與部署",
    purpose:"對手場上出現步兵，這正是守衛機制。你也可以部署步兵保護自己的國王。",
    action:"部署中級步兵，保護國王。",
    why:"只要場上仍有步兵守衛，敵人通常無法直接攻擊你的國王。",
    warning:"非騎兵一般剛部署無法立刻攻擊；防守仍然會生效。" },
  { title:"利用騎兵剋制清除步兵", where:"#kw-field", location:"我方與敵方戰場",
    purpose:"敵方步兵擋住國王攻擊。兵種有相剋關係：騎兵剋步兵。",
    action:"用中級騎兵攻擊敵方初級步兵。",
    why:"四種相剋循環是：步兵→弓兵→法師→騎兵→步兵。選對目標能降低損失。",
    warning:"戰力不是唯一條件，對手兵種特殊能力與狀態也會影響戰果。" },
  { title:"防線突破後繼續攻擊國王", where:"#kw-enemy", location:"敵方戰場",
    purpose:"敵方步兵已被清除，現在再次體驗攻擊國王與 HP 下降。",
    action:"用初級騎兵攻擊敵方國王。",
    why:"真正的勝利條件是擊敗國王，不是只消滅敵方所有場上兵種。",
    warning:"多人局要先選擇目標玩家；特殊能力請查看國王卡及規則。" },
  { title:"迎接最後的挑戰", where:"#kw-top-actions", location:"回合操作區",
    purpose:"最後一戰將從劣勢開始。",
    action:"點「結束回合」，迎接最後一戰。",
    why:"戰場不會永遠順利。落後時要重新評估能用的資源與勝利機會。",
    warning:"下一章將示範每局一次的逆境戰術。" },
  { title:"啟動逆境戰術", where:"#kw-top-actions", location:"逆境戰術",
    purpose:"我方國王 HP 低、兵力不足；逆境戰術符合條件才會解鎖。",
    action:"打開「逆境戰術」，選擇突圍或固守。",
    why:"突圍偏向奪回主動，固守偏向爭取下一回合；兩者都需要支付 2 HP。",
    warning:"此能力每局只能使用一次，護盾不是永久生命值。" },
  { title:"重整戰線，完成試煉", where:"#kw-top-actions", location:"戰場與回合區",
    purpose:"你已發動逆境戰術，查看增加的手牌和護盾。",
    action:"部署兵種或直接結束回合，完成試煉。",
    why:"逆境戰術提供的是一次重整機會，後續決策仍由玩家自己掌握。",
    warning:"選擇適合的兵種即可。" }
];

const TRIAL_CHAPTERS = [
  {title:"初陣：踏上戰場",goal:"學會部署兵種",start:0,end:1,medal:"初陣徽章"},
  {title:"魔導：破局之力",goal:"透過法師強化兵種並攻擊國王",start:1,end:4,medal:"魔導徽章"},
  {title:"鐵壁：破解守衛",goal:"理解回合、步兵守衛與兵種剋制",start:4,end:9,medal:"破陣徽章"},
  {title:"絕境：背水一戰",goal:"在真正劣勢下選擇逆境戰術",start:9,end:11,medal:"逆境徽章"}
];


function GuidedTutorialCoach({ progress=0, onExit, onShowComeback }) {
  const complete = progress >= GUIDED_LESSONS.length;
  const chapterIndex = complete ? 3 : Math.max(0, TRIAL_CHAPTERS.findIndex(ch => progress < ch.end));
  const chapter = TRIAL_CHAPTERS[chapterIndex];
  const step = GUIDED_LESSONS[Math.min(progress, GUIDED_LESSONS.length - 1)];
  const chapterDone = Math.max(0, Math.min(progress - chapter.start, chapter.end - chapter.start));
  const chapterCount = chapter.end - chapter.start;
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [lastChapter, setLastChapter] = useState(chapterIndex);
  useEffect(() => {
    if (lastChapter !== chapterIndex) {
      setLastChapter(chapterIndex);
      setDetailsOpen(true);
    }
  }, [chapterIndex, lastChapter]);
  useEffect(() => {
    if (complete) setDetailsOpen(true);
  }, [complete]);
  return (
    <>
      <section className="trialMiniHud" aria-label="目前任務">
        <span className="trialMiniText">{complete ? "王國試煉完成" : `第 ${chapterIndex+1} 章 · ${step.title}`}</span>
        <button type="button" className="trialOpenButton" onClick={() => setDetailsOpen(true)}>{complete ? "查看成果" : "查看任務"}</button>
      </section>
      {detailsOpen && (
        <div className="trialModalOverlay" role="presentation" onClick={() => setDetailsOpen(false)}>
          <section className="guidedLesson practiceCoach trialCoach trialModalPanel" role="dialog" aria-modal="true" aria-label="王國試煉任務" onClick={e => e.stopPropagation()}>
            <div className="trialChapterHeader">
              <div>
                <span className="trialEyebrow">王國試煉 · 第 {chapterIndex+1} / 4 章</span>
                <h2>{complete ? "🏆 王國試煉完成" : chapter.title}</h2>
                <p className="trialGoal">{complete ? "你已學會基本戰術" : chapter.goal}</p>
              </div>
              <button type="button" className="trialCloseButton" aria-label="關閉任務" onClick={() => setDetailsOpen(false)}>✕</button>
            </div>
            <div className="trialChapters" aria-label="章節進度">
              {TRIAL_CHAPTERS.map((ch,i) => <span key={ch.title} className={progress>=ch.end?"cleared":i===chapterIndex?"current":""}>{progress>=ch.end?"✓":i+1}</span>)}
            </div>
            {complete ? (
              <div className="trialFinish">
                <h3>四章試煉完成！</h3>
                <p>你已學會部署、施法、攻擊、守衛和逆境戰術。</p>
                <div className="trialMedals">{TRIAL_CHAPTERS.map(ch=><span key={ch.medal}>★ {ch.medal}</span>)}</div>
                <button type="button" className="primaryBtn" onClick={onExit}>返回主選單</button>
              </div>
            ) : (
              <div className="trialTaskBody">
                <p className="trialCounter">本章 {chapterDone} / {chapterCount} 項完成</p>
                <h3>🎯 {step.title}</h3>
                <p className="lessonTask">{step.action}</p>
                <details className="trialExplain">
                  <summary>需要提示？</summary>
                  <p>{step.why}</p><p>{step.warning}</p>
                </details>
                <div className="trialModalActions">
                  {progress===9 ? <button type="button" className="primaryBtn" onClick={() => {setDetailsOpen(false);onShowComeback?.();}}>選擇逆境戰術</button> : <button type="button" className="primaryBtn" onClick={() => setDetailsOpen(false)}>開始任務</button>}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function App() {
  const socket = useMemo(() => io(SERVER_URL), []);
  const [name, setName] = useState("");
  const [accountUser, setAccountUser] = useState(null);
  const [accountProfile, setAccountProfile] = useState(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [aiDifficulty, setAiDifficulty] = useState("normal");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [playerId, setPlayerId] = useState(null);
  const [room, setRoom] = useState(null);
  const [returningMatch, setReturningMatch] = useState(null);
  const [returningBusy, setReturningBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState(socket.connected ? "connected" : "connecting");
  const pendingRequestsRef = useRef(new Set());
  const [targetPlayerId, setTargetPlayerId] = useState("");
  const [attackerId, setAttackerId] = useState(null);
  const [magicPlan, setMagicPlan] = useState(null);
  const [r21DeployCard, setR21DeployCard] = useState(null);
  const [r21HandOpen,setR21HandOpen]=useState(false);
  const [r21AbilityOpen,setR21AbilityOpen]=useState(false);
  const [r21AbilityFrom,setR21AbilityFrom]=useState("");
  const [r21AbilityCard,setR21AbilityCard]=useState("");
  const [r21Alexander,setR21Alexander]=useState(false);
  const [r21MoveFrom, setR21MoveFrom] = useState("");
  const [r21CastFrom, setR21CastFrom] = useState("");
  const [r21Spell, setR21Spell] = useState("火球術");
  const [r21CastTo, setR21CastTo] = useState("front");
  const [r21CastPlayerId, setR21CastPlayerId] = useState("");
  const [r21SpellModalOpen, setR21SpellModalOpen] = useState(false);
  const [r21SpellError, setR21SpellError] = useState("");
  const [r21SpellBusy, setR21SpellBusy] = useState(false);
  const r21SpellRequestRef = useRef(false);
  const [showHelp, setShowHelp] = useState(false);
  const [cardDetailModal, setCardDetailModal] = useState(null);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showComebackGuide, setShowComebackGuide] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [mobileDeckTab, setMobileDeckTab] = useState("units");
  const [mobileHandPage, setMobileHandPage] = useState(0);
  const [showMobileBattleMenu, setShowMobileBattleMenu] = useState(false);
  const [mobileActionModal, setMobileActionModal] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [attackFeedback, setAttackFeedback] = useState(null);
  const lastLogRef = useRef("");
  const [turnOrderNotice, setTurnOrderNotice] = useState(null);
  const previousRoomStatusRef = useRef(null);
  const cardDetailPressTimerRef = useRef(null);

  function openCardDetail(card, source = "卡片", allowUnitInfo = false) {
    // Only an explicit info control opens unit details; action taps stay unchanged.
    if (!allowUnitInfo && shouldBlockUnitCardDetail(card, source)) return;
    const detail = buildCardDetail(card, source);
    if (detail) setCardDetailModal(detail);
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
    // Only tick when a visible countdown needs to update. Avoid forcing the
    // entire card-heavy game view to re-render once per second otherwise.
    const needsCountdown = Boolean(
      returningMatch?.deadline ||
      (room && room.status === "playing" && Number(room.settings?.turnTimeLimit || 0) > 0 && room.turnStartedAt)
    );
    if (!needsCountdown) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [returningMatch?.deadline, room?.status, room?.settings?.turnTimeLimit, room?.turnStartedAt]);

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
      performanceDiagnostics?.recordRoomUpdate();
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
    const disconnected = () => {
      setConnectionStatus("disconnected");
      if (localStorage.getItem("kw_session")) {
        setRoom(null);
        setPlayerId(null);
      }
    };
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
    // Check an existing match without taking over a live session.
    function inspectSavedMatch() {
      const raw = localStorage.getItem("kw_session");
      if (!raw) return;
      let credentials;
      try { credentials=JSON.parse(raw); }
      catch { localStorage.removeItem("kw_session"); return; }
      if (!credentials?.roomCode || !credentials?.playerId || !credentials?.resumeToken) {
        localStorage.removeItem("kw_session");
        return;
      }
      if (!socket.connected) return;
      socket.timeout(5000).emit("room:inspect",credentials,(error,res)=>{
        if (error) {
          setMessage("無法查詢上次的對戰，請檢查連線後重試。");
          return;
        }
        if (!res?.ok) {
          // Do not erase a valid token for transient errors. Only completed games are expired.
          if (res?.finished) localStorage.removeItem("kw_session");
          setReturningMatch(null);
          if (!res?.finished) setMessage(res?.error || "目前無法恢復對戰。");
          return;
        }
        setReturningMatch({credentials,...res});
      });
    }
    socket.on("connect",inspectSavedMatch);
    if (socket.connected) inspectSavedMatch();
    socket.on("session:replaced",({reason}={})=>{
      localStorage.removeItem("kw_session");
      setRoom(null);setPlayerId(null);setReturningMatch(null);
      setMessage(reason || "此場對戰已在另一個裝置恢復。");
    });
    return ()=>{
      socket.off("connect",inspectSavedMatch);
      socket.off("session:replaced");
    };
  },[socket]);

  function chooseReturnToMatch() {
    if (!returningMatch || returningBusy) return;
    setReturningBusy(true);
    const credentials=returningMatch.credentials;
    requestNow("room:resume",credentials,(res)=>{
      setReturningBusy(false);
      if (!res?.ok) {
        if (res?.finished) { localStorage.removeItem("kw_session"); setReturningMatch(null); }
        setMessage(res?.error || "暫時無法返回對戰，請重試。");
        return;
      }
      rememberSession(res.playerId,res.room,res.resumeToken);
      setPlayerId(res.playerId);
      setRoom(res.room);
      setReturningMatch(null);
      setTargetPlayerId("");
      setAttackerId(null);
      setMagicPlan(null);
      setMessage("");
    });
  }

  function chooseForfeitReturningMatch() {
    if (!returningMatch || returningBusy) return;
    if (!window.confirm("放棄後會直接判定投降，無法恢復這場對戰。確定嗎？")) return;
    setReturningBusy(true);
    requestNow("room:forfeit",returningMatch.credentials,(res)=>{
      setReturningBusy(false);
      if (!res?.ok) return setMessage(res?.error || "無法放棄對戰，請重試。");
      clearSavedSession();
      setReturningMatch(null);
      setRoom(null);
      setPlayerId(null);
      setMessage("已放棄原本的對戰。");
    });
  }

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

  React.useEffect(() => {
    let active = true;
    async function syncAccount() {
      try {
        const user = await loadAccount();
        if (!active) return;
        setAccountUser(user);
        if (!user || user.is_anonymous) { setAccountProfile(null); return; }
        const profile = await ensurePlayerProfile(user, localStorage.getItem("kw_display_name"));
        if (active) { setAccountProfile(profile); if (profile?.display_name) { setName(profile.display_name); localStorage.setItem("kw_display_name",profile.display_name); } }
      } catch (error) {
        if (active) setAccountMessage("無法讀取帳號資料：" + error.message);
      }
    }
    void syncAccount();
    const { data:{ subscription } } = supabase.auth.onAuthStateChange(() => {
      // Defer data queries outside the auth callback to avoid auth-client lock contention.
      window.setTimeout(() => { if (active) { setAccountMessage(""); setAccountBusy(false); void syncAccount(); } },0);
    });
    return () => { active = false; subscription.unsubscribe(); };
  },[]);

  async function saveDisplayName() {
    const clean = Array.from((name || "").normalize("NFKC").trim()).slice(0,16).join("");
    if (!clean) return;
    localStorage.setItem("kw_display_name",clean);
    if (!accountUser || accountUser.is_anonymous || accountProfile?.display_name === clean) return;
    try {
      const {data,error} = await supabase.from("player_profiles")
        .update({display_name:clean,updated_at:new Date().toISOString()})
        .eq("user_id",accountUser.id)
        .select("user_id,display_name,created_at").single();
      if(error) throw error;
      setAccountProfile(data);
      setAccountMessage("");
    } catch(error) { setAccountMessage("暱稱儲存失敗：" + error.message); }
  }

  async function loginWithGoogle() {
    if (accountBusy) return;
    setAccountBusy(true);setAccountMessage("");
    try {
      const {error} = await supabase.auth.signInWithOAuth({
        provider:"google",
        options:{ redirectTo:window.location.origin }
      });
      if(error) throw error;
      // The browser normally navigates to Google; reset if navigation is blocked.
      setAccountBusy(false);
    } catch(error) {
      setAccountMessage("Google 登入失敗：" + error.message);
      setAccountBusy(false);
    }
  }
  async function logoutGoogle() {
    if (room && room.status !== "ended") {
      setAccountMessage("請先結束或離開房間，再登出帳號。");
      return;
    }
    setAccountBusy(true);
    try {
      const {error}=await supabase.auth.signOut();
      if(error) throw error;
      setAccountUser(null);setAccountProfile(null);setAccountMessage("已登出 Google 帳號。");
    } catch(error) {setAccountMessage("登出失敗：" + error.message);}
    finally {setAccountBusy(false);}
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
    setReturningMatch(null);
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

    requestNow("room:leave", {}, (res) => {
      if (!res?.ok) setMessage(res?.error || "離開房間失敗");
    });

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

    setMessage("正在準備王國試煉…");

    requestNow("tutorial:start", { name: safeName() }, (res) => {
      if (!res?.ok) return setMessage(res?.error || "無法開始王國試煉");

      setPlayerId(res.playerId);
      setRoom(res.room);

      if (typeof rememberSession === "function") {
        rememberSession(res.playerId, res.room, res.resumeToken);
      }

      setMessage("王國試煉已開始。點「查看任務」取得提示。");
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
          {returningMatch && <div className="returnMatchOverlay" role="dialog" aria-modal="true" aria-label="返回對戰">
            <div className="returnMatchPanel">
              <h2>尚有未完成的對戰</h2>
              <p>房間 {returningMatch.roomCode} · {returningMatch.playerName}</p>
              <p>{returningMatch.deadline ? `離線倒數：${Math.floor(Math.max(0,returningMatch.deadline-now)/60000)} 分 ${String(Math.floor(Math.max(0,returningMatch.deadline-now)%60000/1000)).padStart(2,"0")} 秒。超過期限將自動投降。` : "你可以返回原本的房間繼續遊戲。"}</p>
              <div className="returnMatchChoices">
                <button type="button" disabled={returningBusy} className="secondary" onClick={chooseForfeitReturningMatch}>放棄對戰</button>
                <button type="button" disabled={returningBusy} className="primaryBtn" onClick={chooseReturnToMatch}>返回對戰</button>
              </div>
              {message && <p className="error" role="alert">{message}</p>}
            </div>
          </div>}
          <div className="kwAccountPanel" aria-label="玩家帳號">
            {accountUser && !accountUser.is_anonymous ? <>
              <span>已登入：{name.trim() || accountProfile?.display_name || "玩家"}</span>
              <button type="button" disabled={accountBusy} onClick={logoutGoogle}>登出</button>
            </> : <>
              <button type="button" disabled={accountBusy} onClick={loginWithGoogle}>使用 Google 登入</button>
              <small>也可以不登入，直接以遊客身分遊玩。</small>
            </>}
            {accountMessage && <p role="status">{accountMessage}</p>}
          </div>
          <div className="titleBadge">Online Multiplayer</div>
          <h1>國王戰爭 {room?.rules === "R2.1" ? "· R2.1" : ""}</h1>
          <p>和朋友對戰、挑戰電腦，或尋找線上對手。</p>

          <label>暱稱 / 遊戲 ID</label>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveDisplayName} maxLength={16} placeholder="例如 Wayne；不填會自動產生 ID" />
          <p className="idHint">留空即可使用隨機暱稱。</p>

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
              <p>選好難度即可開始。</p>
              <div className="settingButtonGroup">
                {[["easy","簡單"],["normal","中等"],["hard","困難"],["conqueror","征服者"]].map(([id,label]) => (
                  <button type="button" key={id} className={aiDifficulty === id ? "settingChoice active" : "settingChoice"}
                    onClick={() => setAiDifficulty(id)}>{label}</button>
                ))}
              </div>
              <button className="primaryBtn" onClick={startSinglePlayer}>開始單人對戰</button>
            </section>
            <section className="startBox matchBox">
              <h2>隨機匹配</h2>
              <p>尋找對手。暫時無人時會建立房間。</p>
              <button className="matchBtn" onClick={randomMatch}>尋找公開房間</button>
            </section>
          </div>

          <div className="quickRules">
            <strong>勝利條件：</strong>將敵方國王的 HP 降至 0。<br />
            <strong>每回合：</strong>部署、攻擊或施法，完成後結束回合。<br />
            <strong>急援：</strong>回合開始時沒有兵種？首張初、中級兵種可立即出擊。<br />
            <strong>逆境戰術：</strong>落後時可消耗 2 HP，選擇突圍或固守。每局一次。
          </div>

          <button
            className="secondary openTutorialBtn"
            onClick={() => {
              startTutorialRoom();
            }}
          >
            開始王國試煉
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
  const isMyTurn = room.currentPlayerId === playerId && room.phase !== "guard" && room.phase !== "qinChoice";
  const isR21 = room.rules === "R2.1";
  const qinPending=isR21&&room.phase==="qinChoice"&&room.currentPlayerId===playerId;
  const r21AbilityAvailable=isMyTurn&&room.ap>0&&!me?.abilityUsed;
  const r21SpellDetails = {
    "火球術":[1,"enemy","消滅初級兵種；其他兵種戰力 -1（不可重複）。"],
    "冰凍術":[1,"enemy","凍結敵方兵種，使其下一回合無法行動。"],
    "力量術":[1,"self","我方兵種下一次戰鬥戰力 +1。"],
    "虛弱術":[2,"enemy","敵方兵種下一次戰鬥戰力 -1。"],
    "增強術":[2,"self","我方兵種攻擊國王時傷害 +1。"],
    "流星雨":[2,"enemy","消滅指定敵方玩家場上所有初級兵種，無須選站位。"],
    "毒藥瓶":[3,"enemy","敵方兵種在其回合結束時被消滅。"],
    "燃血術":[3,"self","消耗我方國王 3 HP，使我方兵種下一次戰鬥戰力 +2。"],
    "天殞術":[3,"enemy","消滅敵方兵種；施法法師下一回合無法行動。"]
  };
  const r21Positions = {front:"前排",center:"中排",rear:"後排"};
  const r21Mages=(me?.field||[]).filter(u=>u.type==="魔法師");
  const r21Caster=r21Mages.find(u=>u.position===r21CastFrom);
  const r21CasterLevel=r21Caster?["初級","中級","高級"].indexOf(r21Caster.rank)+1:0;
  const r21AvailableSpells=Object.entries(r21SpellDetails).filter(([,v])=>v[0]<=r21CasterLevel);
  const r21ChosenSpell=r21AvailableSpells.some(([n])=>n===r21Spell)?r21Spell:"";
  const r21SpellInfo=r21SpellDetails[r21ChosenSpell];
  const r21SpellTargets=r21SpellInfo?.[1]==="self"?(me?[me]:[]):room.players.filter(p=>p.id!==playerId&&!p.eliminated);
  const r21CastPlayer=r21SpellTargets.find(p=>p.id===r21CastPlayerId);
  const r21ValidUnits=(r21CastPlayer?.field||[]).filter(u=>r21ChosenSpell==="流星雨"?u.rank==="初級":r21ChosenSpell==="火球術"&&u.rank==="初級"?true:!(u.status||[]).includes(r21ChosenSpell));
  const r21CastUnit=r21ValidUnits.find(u=>u.position===r21CastTo);
  const r21MageReason=u=>u.acted?"已行動／已普攻或施法":u.locked?"受到禁制，無法施法":"";
  const r21CastBlocked=!isMyTurn||room.phase!=="play"?"目前不是你的施法回合。":!socket.connected?"連線中斷，請重新確認戰場。":!r21Caster?"請先選擇法師。":r21MageReason(r21Caster)|| (room.ap<=0?`需要 1 AP，目前剩 ${room.ap} AP。`:room.spellUsed?"本回合施法次數已用完。":!r21SpellInfo?"請選擇法術。":r21ChosenSpell==="燃血術"&&me.hp<=3?"燃血術需要國王 HP 高於 3。":!r21CastPlayer?"請選擇目標玩家（原目標可能已離場）。":!r21ValidUnits.length?"目前沒有合法目標兵種。":r21ChosenSpell!=="流星雨"&&!r21CastUnit?"請選擇合法兵種（原目標可能已失效）。":"");
  const resetR21Spell=()=>{setR21SpellModalOpen(false);setR21CastFrom("");setR21Spell("");setR21CastPlayerId("");setR21CastTo("");setR21SpellError("");};
  const submitR21Spell=()=>{
    if(r21CastBlocked||r21SpellRequestRef.current||!r21CastPlayer)return;
    r21SpellRequestRef.current=true;setR21SpellBusy(true);setR21SpellError("");
    const sent=requestNow("game:r21Cast",{from:r21CastFrom,spell:r21ChosenSpell,player:r21CastPlayer.id,to:r21ChosenSpell==="流星雨"?"front":r21CastTo},res=>{
      r21SpellRequestRef.current=false;setR21SpellBusy(false);
      if(res?.ok){resetR21Spell();setMessage("");}
      else setR21SpellError(res?.error||"施法失敗，請重新確認戰場。");
    });
    if(!sent){r21SpellRequestRef.current=false;setR21SpellBusy(false);setR21SpellError("請求未送出。");}
  };

  const mustGuard = isR21 && room.phase === "guard" && room.pending?.defenderId === playerId;
  const enemies = room.players.filter((p) => p.id !== playerId && !p.eliminated);
  const targetPlayer = enemies.find((p) => p.id === targetPlayerId) || enemies[0];
  const attacker = me?.field.find((u) => u.id === attackerId);
  const magicTargetPlayer = room.players.find((p) => p.id === magicPlan?.targetPlayerId);
  const hint = actionHint({ room, me, isMyTurn, attacker, targetPlayer, magicPlan });
  const readyUnits = (me?.field || []).filter(canUnitStillAct).length;
  const battleInstruction = room.status === "tutorialComplete" ? "試煉完成！點「查看成果」領取徽章。" : !isMyTurn
    ? "對手回合。查看戰場，準備下一步。"
    : magicPlan ? "選擇法師與目標，確認後施放魔法。"
    : attacker ? `已選擇「${attacker.name}」：點敵方兵種進攻；沒有步兵守衛時可直接攻王。`
    : me?.hand?.length ? "從手牌部署兵種，或點選我方兵種進攻。"
    : "手牌已空。你可以進攻或結束回合。";

  const contextualTraining = !isMyTurn ? null
    : me?.comebackAvailable ? "逆境戰術已解鎖，可選擇突圍或固守。"
    : me?.king?.name === "成吉思汗" && me.field.some(u=>u.type==="騎兵") && !me.recallUsed
      ? "成吉思汗可撤回騎兵，重新安排攻勢。"
    : me?.field?.some(u=>u.type==="弓兵" && canUnitStillAct(u))
      ? "弓兵能追加攻擊或保住性命。詳見卡牌效果。"
    : me?.field?.some(u=>u.type==="法師" && canUnitStillAct(u)) && me?.magic?.length
      ? "魔法已就緒。選擇魔法卡開始施放。"
      : null;

  const gameEnded = room.status === "ended";
  const winner = gameEnded ? (isR21 ? room.players.find((p) => p.id === room.winnerId) : room.players.find((p) => !p.eliminated && p.hp > 0)) : null;
  // R2.1 settlement is authoritative: compare stable server winnerId directly.
  // Another participant leaving the result screen must never change this result.
  const didWin = gameEnded && (isR21 ? room.winnerId != null && room.winnerId === playerId : winner?.id === playerId);
  const isSingleplayerRoom = room.players.some((p) => p.isAI);

  if (room.status === "lobby") {
    return (
      <main className="page centered">
        <section className="card hero lobbyCard">
          <div className="titleBadge">{room.roomType || "房間"} Code</div>
          <h1>{room.roomCode}</h1>
          <p><strong>測試規則 R2.1：</strong>此房間以原版介面進行新規則對戰，24 HP、每回合 2 AP、三個站位。請使用兩位真人玩家加入並開始遊戲。</p>
          <label htmlFor="r21-king-select">選擇本局國王</label>
          <select id="r21-king-select" value={me?.r21King||""} onChange={e=>emit("room:r21SelectKing",{king:e.target.value})}>
            <option value="">尚未選擇（開始時自動分配）</option>
            {["亞歷山大","屋大維","成吉思汗","秦始皇","路易十四"].map(k=><option key={k} value={k} disabled={room.players.some(p=>p.id!==playerId&&p.r21King===k)}>{k}</option>)}
          </select>
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
    emit("game:attackUnit", { attackerId, targetPlayerId: targetPlayer.id, defenderId,alexander:room.rules==="R2.1"&&r21Alexander });
    setR21Alexander(false);
    setAttackerId(null);
  }

  function attackKing() {
    closeCardDetailForAction();
    if (!attackerId || !targetPlayer) return setMessage("請先選擇攻擊者和目標玩家。");
    emit("game:attackKing", { attackerId, targetPlayerId: targetPlayer.id,alexander:room.rules==="R2.1"&&r21Alexander });
    setR21Alexander(false);
    setAttackerId(null);
  }

  function handleEndTurn() {
    if(room.rules==="R2.1"){emit("game:endTurn");return;}
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
    setMessage("");
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
    <main className={`page guidedPage kwCombatV3 ${mobileDeckTab === "magic" ? "mobileDeckMagic" : "mobileDeckUnits"}`}>
      <header className="topbar guidedTopbar" id="kw-top-actions">
        <div>
          <div className="titleBadge">Room {room.roomCode}</div>
          <h1>國王戰爭</h1>
          <p>{room.status === "tutorialComplete" ? "新手操作教學已完成" : isMyTurn ? "輪到你行動" : "等待其他玩家行動"}</p>
          {turnRemaining !== null && (
            <div className={turnRemaining <= 10 ? "turnTimer danger" : "turnTimer"}>
              回合倒數：{turnRemaining} 秒
            </div>
          )}
        </div>

        <div className="topActions">
          <button type="button" className="mobileBattleMenuButton" onClick={() => setShowMobileBattleMenu(true)} aria-label="開啟遊戲選單">☰ 選單</button>
          <button className="secondary" onClick={() => setShowHelp((v) => !v)}>{showHelp ? "隱藏提示" : "顯示提示"}</button>
          <button className="secondary" onClick={() => setShowRulesModal(true)}>規則</button>
          <button className="secondary" onClick={() => setShowLogModal(true)}>紀錄</button>
          <button className="secondary" onClick={returnToMainMenu}>回到主選單</button>
          <button type="button" className={me?.comebackAvailable ? "lastStandEntry unlocked" : "lastStandEntry"}
            onClick={() => setShowComebackGuide(true)}>
            {me?.lastStandUsed ? "逆境戰術 ✓ 已使用" : me?.comebackAvailable ? "⚔ 逆境戰術 · 可啟動" : "逆境戰術 · 查看條件"}
          </button>
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

      {showMobileBattleMenu && (
        <section className="rulesLogOverlay mobileBattleMenuOverlay" onClick={() => setShowMobileBattleMenu(false)}>
          <div className="rulesLogPanel mobileBattleMenuPanel" role="dialog" aria-modal="true" aria-label="遊戲選單" onClick={e => e.stopPropagation()}>
            <div className="rulesLogTop"><strong>遊戲選單</strong><button className="secondary" onClick={() => setShowMobileBattleMenu(false)}>關閉</button></div>
            <button onClick={() => { setShowMobileBattleMenu(false);setShowRulesModal(true); }}>遊戲規則</button>
            <button onClick={() => { setShowMobileBattleMenu(false);setShowLogModal(true); }}>戰鬥紀錄</button>
            {!room.tutorial && <button onClick={() => { setShowMobileBattleMenu(false);setShowHelp(true); }}>操作提示</button>}
            <button onClick={() => { setShowMobileBattleMenu(false);setShowComebackGuide(true); }}>逆境戰術</button>
            {room.tutorial && <button onClick={() => { setShowMobileBattleMenu(false); }}>任務提示請點戰場上的「查看任務」</button>}
            <button className="secondary" onClick={() => { setShowMobileBattleMenu(false);returnToMainMenu(); }}>返回主選單</button>
          </div>
        </section>
      )}

      {showComebackGuide && (
        <section className="rulesLogOverlay" onClick={() => setShowComebackGuide(false)}>
          <div className="rulesLogPanel lastStandGuide" role="dialog" aria-modal="true" aria-label="逆境戰術" onClick={(e)=>e.stopPropagation()}>
            <div className="rulesLogTop">
              <strong>⚔ 逆境戰術 · 背水一戰</strong>
              <button type="button" className="secondary" onClick={()=>setShowComebackGuide(false)}>關閉</button>
            </div>
            <p>落後時可付出 2 HP 反擊。每局只能使用一次。</p>
            <div className="lastStandRequirements">
              <div><span>國王 HP 介於 4～12</span><strong>{me?.hp >= 4 && me?.hp <= 12 ? "✓ 符合" : "尚未符合"}</strong></div>
              <div><span>我方場上兵種 ≤ 2</span><strong>{(me?.field?.length || 0) <= 2 ? "✓ 符合" : "尚未符合"}</strong></div>
              <div><span>敵方 HP 領先至少 6，或兵力多至少 2</span><strong>{enemies.some(e => e.hp >= (me?.hp || 0)+6 || (e.field?.length || 0) >= (me?.field?.length || 0)+2) ? "✓ 符合" : "尚未符合"}</strong></div>
              <div><span>尚未使用、輪到自己且此局開啟該規則</span><strong>{me?.comebackAvailable ? "✓ 可使用" : me?.lastStandUsed ? "本局已使用" : "目前未開放"}</strong></div>
            </div>
            <div className="lastStandStrategyGrid">
              <div className="lastStandStrategy">
                <h3>⚔ 突圍</h3><p>消耗 2 HP · 抽 2 張兵種 · 獲得一次緊急部署 · 國王護盾 3 點</p>
                <button type="button" className="primaryBtn" disabled={!me?.comebackAvailable || !isMyTurn}
                  onClick={()=>{if(window.confirm("確定發動突圍？此局只能使用一次，消耗 2 HP。")){emit("game:lastStand",{mode:"assault"});setShowComebackGuide(false);}}}>選擇突圍</button>
              </div>
              <div className="lastStandStrategy">
                <h3>🛡 固守</h3><p>消耗 2 HP · 抽 1 張兵種 · 國王護盾 7 點</p>
                <button type="button" className="primaryBtn" disabled={!me?.comebackAvailable || !isMyTurn}
                  onClick={()=>{if(window.confirm("確定發動固守？此局只能使用一次，消耗 2 HP。")){emit("game:lastStand",{mode:"defense"});setShowComebackGuide(false);}}}>選擇固守</button>
              </div>
            </div>
            <p className="lastStandFinePrint">護盾在下次輪到你時消失，且每次攻王至少造成 1 點傷害。</p>
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

            <h2>遊戲規則</h2>

            <div className="rulesGrid">
              <div className="ruleBlock">
                <h3>兵種效果速查</h3>
                <p><strong>步兵：</strong>守護國王。對手必須先清除步兵才能攻王。</p>
                <p><strong>弓兵：</strong>遠射。符合條件時可追加攻擊或避免陣亡。</p>
                <p><strong>法師：</strong>使用魔法卡；施法消耗一次行動。</p>
                <p><strong>騎兵：</strong>初、中級騎兵部署後即可攻擊。</p>
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
                <p>將其他國王的 HP 降到 0，即可獲勝。</p>
                <p>敵方有步兵時，先清除步兵才能攻王。</p>
              </div>

              <div className="ruleBlock">
                <h3>回合流程</h3>
                <p>自由安排部署、攻擊和施法。完成後結束回合。</p>
                <p><strong>逆境戰術：</strong>HP 4～12、我方場上不超過 2 兵種，而且敵軍明顯領先時，可付出 2 HP 選擇突圍或固守。每局一次。</p>
              </div>

              <div className="ruleBlock">
                <h3>卡片說明</h3>
                <p>點卡片上的「i」可查看效果。也可長按卡片。</p>
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

            <small>點卡牌上的「i」可隨時查看效果。</small>
          </div>
        </section>
      )}

      {room.openingTruceActive && (
        <section className="guidedLesson">
          <h2>戰前部署期間</h2>
          <p>第一輪只能部署兵種，暫時不能攻擊或對敵人施法。</p>
        </section>
      )}
      {room?.tutorial && <GuidedTutorialCoach key={room.roomCode} progress={room.tutorialProgress || 0} onExit={returnToMainMenu} onShowComeback={() => setShowComebackGuide(true)} />}

      {attackFeedback && (
        <div className="attackFeedbackToast">
          <span>⚔️</span>
          <strong>{attackFeedback}</strong>
        </div>
      )}

      {isMyTurn && me?.reinforcementAvailable && !me?.reinforcementUsed && (
        <div className="reinforcementNotice">
          急援已啟動：首張初、中級兵種部署後即可攻擊。
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

      {showHelp && !gameEnded && !room.tutorial && <GuidePanel hint={hint} />}

      <div className="kwBattleFrame" aria-label="集中戰鬥介面">
        <div className="kwScoreStrip" aria-label="國王血量與目標玩家">
          <button type="button" className="kwKingChip own" onClick={()=>me?.king && openCardDetail({...me.king,kind:"king"},"國王")}>
            <span className="kwKingChipLabel">我方 · {me?.name || "玩家"}</span>
            <strong>{me?.king?.name || "國王"} <span className="kwHp">HP {me?.hp ?? "—"}</span></strong>
          </button>
          <div className="kwEnemyChips" role="group" aria-label="選擇對手並查看血量">
            {enemies.map(player=>(
              <div className={`kwEnemyChipWrap ${targetPlayer?.id===player.id?"mobileSelectedEnemy":""}`} key={player.id}>
                <button type="button"
                  className={`kwKingChip enemy ${targetPlayer?.id===player.id?"active":""}`}
                  aria-pressed={targetPlayer?.id===player.id}
                  aria-label={`選擇對手 ${player.name}，國王 ${player.king?.name || ""}，血量 ${player.hp}`}
                  onClick={()=>setTargetPlayerId(player.id)}>
                  <span className="kwKingChipLabel">{player.name}{player.eliminated?" · 出局":""}</span>
                  <strong>{player.king?.name || "國王"} <span className="kwHp">HP {player.hp}</span></strong>
                  <span className="kwKingChipResources">手牌 {player.handCount} · 魔法 {player.magicCount}</span>
                </button>
                <button type="button" className="kwEnemyKingInfo" aria-label={`查看 ${player.name} 的國王能力`}
                  title="查看國王能力" onClick={()=>player.king && openCardDetail({...player.king,kind:"king"},"國王")}>?</button>
              </div>
            ))}
            {enemies.length > 1 && <button type="button" className="mobileTargetCycle" onClick={() => setTargetPlayerId(enemies[(enemies.findIndex(e=>e.id===targetPlayer?.id)+1)%enemies.length].id)}>換目標 ↻</button>}
          </div>
        </div>
      <section className="battleActionHub" aria-label="本回合操作導覽">
        <div className="battleActionHeader">
          <div>
            <span className="battleEyebrow">操作提示</span>
            <h2>{isMyTurn ? (magicPlan ? "施法" : attacker ? "選擇攻擊目標" : "部署或攻擊") : "等待對手"}</h2>
          </div>
          <span className="battleReadyCount">可行動兵種 {readyUnits} / {me?.field?.length || 0}</span>
        </div>
        <p role="status" aria-live="polite" className="battleInstruction">{battleInstruction}</p>
        <p className="mobileBattlePrompt" aria-live="polite">{!isMyTurn ? "等待對手行動" : magicPlan ? "施法中 · 選法師與目標" : attacker ? `已選 ${attacker.name} · 點敵軍或攻王` : "選我方兵種攻擊，或從手牌部署"}</p>
        {me?.king && <button type="button" className="battleKingHelp" onClick={()=>openCardDetail({...me.king,kind:"king"},"國王")}>
          查看我的王權：{me.king.name}
        </button>}
        {contextualTraining && <p className="battleMechanicTip"><strong>特殊功能實戰提示：</strong>{contextualTraining}</p>}
        <nav className="battleQuickNav" aria-label="戰鬥區域快速導覽">
          <a href="#kw-hand">1. 手牌／部署</a>
          <a href="#kw-field">2. 我方兵種</a>
          <a href="#kw-enemy">3. 選擇敵人</a>
          {magicPlan && <a href="#kw-magic">魔法施放步驟</a>}
        </nav>
        {attacker && !magicPlan && (
          <button type="button" className="secondary" onClick={() => setAttackerId(null)}>
            <span aria-hidden="true">× </span>取消選擇：{attacker.name}
          </button>
        )}
      </section>

      {(!isR21||r21HandOpen||mustGuard)&&<section className={`handAndLog ${isR21?"r21HandModal":""}`} id="kw-hand">
        <div className="mobileDeckControls" role="group" aria-label="選擇手牌種類">
          <button type="button" className={mobileDeckTab === "units" ? "selected" : ""} onClick={() => {setMobileDeckTab("units");setMobileHandPage(0);}}>兵種 {me?.hand?.length || 0}</button>
          <button type="button" className={mobileDeckTab === "magic" ? "selected" : ""} onClick={() => {setMobileDeckTab("magic");setMobileHandPage(0);}}>魔法 {me?.magic?.length || 0}</button>
          {(mobileDeckTab === "units" ? (me?.hand?.length || 0) : (me?.magic?.length || 0)) > 4 && <div className="mobileHandPaging">
            <button type="button" disabled={mobileHandPage === 0} onClick={() => setMobileHandPage(p => Math.max(0, p-1))} aria-label="上一頁手牌">‹</button>
            <span>{Math.min(mobileHandPage, Math.ceil((mobileDeckTab === "units" ? (me?.hand?.length || 0) : (me?.magic?.length || 0))/4)-1)+1} / {Math.ceil((mobileDeckTab === "units" ? (me?.hand?.length || 0) : (me?.magic?.length || 0))/4)}</span>
            <button type="button" disabled={(mobileHandPage+1)*4 >= (mobileDeckTab === "units" ? (me?.hand?.length || 0) : (me?.magic?.length || 0))} onClick={() => setMobileHandPage(p => p+1)} aria-label="下一頁手牌">›</button>
          </div>}
        </div>
        <div className="battleHandPrimary">
        <section className="zoneCard">
          <div className="zoneHeader">
            <div>
              <h2>兵種手牌 <small>({me?.hand?.length || 0})</small></h2>
              <p>{isR21 ? "點選卡牌部署至前／中／後排（最多 3 名）。" : "點選卡牌部署（場上最多 5 名）。"}</p>
            </div>
          </div>

          <div className="cardGrid">
            {me?.hand?.length ? (
              me.hand.map((card) => (
                <button
                  key={card.id}
                  className={`gameCard unit handCard ${me.hand.indexOf(card) < Math.min(mobileHandPage, Math.max(0, Math.ceil(me.hand.length/4)-1))*4 || me.hand.indexOf(card) >= (Math.min(mobileHandPage, Math.max(0, Math.ceil(me.hand.length/4)-1))+1)*4 ? "mobileHandHidden" : ""}`}
                  disabled={!isMyTurn || !!magicPlan}
                  onClick={() => openMobileActionModal(card, "兵種手牌", "部署這張兵種", () => { if(isR21){const available=["front","center","rear"].filter(pos=>!me.field.some(u=>u.position===pos));setR21DeployCard(card);}else emit("game:deploy",{cardId:card.id}); })}
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
            ) : <EmptyState>目前沒有兵種手牌。牌庫抽完後會重新補充；下一回合可再抽牌。</EmptyState>}
          </div>
        </section>

      {magicPlan && (
        <section className="magicPanel guidedMagicPanel" id="kw-magic">
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
        </div>

        <aside className="sideColumn">
          <section className="zoneCard">
            <h2>魔法 <small>({me?.magic?.length || 0})</small></h2>
            <p>點選魔法開始施放。</p>
            <div className="magicList">
              {me?.magic?.length ? me.magic.map((card,index) => <MagicCard onDetail={openCardDetail} key={card.id} card={card} hiddenMobile={index < Math.min(mobileHandPage,Math.max(0,Math.ceil(me.magic.length/4)-1))*4 || index >= (Math.min(mobileHandPage,Math.max(0,Math.ceil(me.magic.length/4)-1))+1)*4} disabled={!isMyTurn || !!magicPlan} onClick={() => openMobileActionModal(card, "魔法卡", "使用這張魔法", () => { setMobileDeckTab("units"); beginMagic(card); })} />) : <EmptyState>沒有魔法卡。場上有法師時，回合開始會抽魔法。</EmptyState>}
            </div>
          </section>

        </aside>
      </section>}
      {isR21&&<div className="r21HandEntry"><button type="button" onClick={()=>{setR21HandOpen(v=>!v);setR21DeployCard(null);}}>{r21HandOpen?"關閉手牌":"兵種手牌 ("+(me?.hand?.length||0)+")"}</button><span>AP {room.ap}/2 · {isMyTurn?"我方回合":"等待／回應階段"}</span></div>}

      <section className="battleGrid">
        <section className="zoneCard enemyZone" id="kw-enemy">
          <div className="zoneHeader">
            <div>
              <h2>敵方兵種 · {targetPlayer?.name || "對手"}</h2>
              <span className="mobileUnitCount">{targetPlayer?.field?.length || 0} / 5</span>
              <p>{targetHasInfantry ? "步兵守衛" : "國王可攻擊"}</p>
            </div>
            <div className="kwKingAttackAction" aria-label="攻擊敵方國王操作">
              <span className="kwKingAttackStatus">{targetHasInfantry ? "敵方步兵仍在守衛國王" : !isMyTurn ? "目前不是你的回合" : !attackerId ? "請先點選我方可行動兵種" : "已選攻擊者，可以攻擊國王"}</span>
              <button className="dangerBtn kwKingAttackBtn" disabled={!isMyTurn || !attackerId || targetHasInfantry || !!magicPlan} onClick={attackKing}><span className="desktopAttackKingLabel">{targetHasInfantry ? "步兵守衛中" : "⚔ 攻擊敵方國王"}</span><span className="mobileAttackKingLabel">{targetHasInfantry ? "守衛中" : "攻王"}</span></button>
            </div>
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
            {Array.from({length:Math.max(0,5-(targetPlayer?.field?.length || 0))},(_,i)=><div key={`enemy-empty-${i}`} className="mobileEmptySlot" aria-hidden="true">＋</div>)}
          </div>
        </section>

        <section className="zoneCard myZone" id="kw-field">
          <div className="zoneHeader">
            <div>
              <h2>我方兵種</h2>
              <span className="mobileUnitCount">{me?.field?.length || 0} / 5</span>
              <p>點兵種選攻擊者。</p>
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
            {Array.from({length:Math.max(0,5-(me?.field?.length || 0))},(_,i)=><div key={`own-empty-${i}`} className="mobileEmptySlot" aria-hidden="true">＋</div>)}
          </div>
        </section>
      </section>
      </div>
      {qinPending&&<div className="r21SpellBackdrop"><section className="r21SpellDialog" role="dialog" aria-modal="true" aria-label="秦始皇抽三放一"><header className="r21SpellHeader"><h2>秦始皇 · 抽三放一</h2></header><div className="r21SpellBody"><p>以下三張牌僅你可見。選擇一張放回牌庫底部；完成前不會切換回合。</p><div className="r21MageGrid">{(room.qinChoice||[]).map(c=><button key={c.id} onClick={()=>emit("game:r21QinChoose",{cardId:c.id})}><strong>{c.name}</strong><span>放回牌庫底部</span></button>)}</div></div></section></div>}
      {r21AbilityOpen&&isR21&&<div className="r21SpellBackdrop"><section className="r21SpellDialog" role="dialog" aria-modal="true" aria-label="國王能力"><header className="r21SpellHeader"><h2>{me.king.name} · 國王能力</h2><button onClick={()=>setR21AbilityOpen(false)}>✕</button></header><div className="r21SpellBody"><p>每回合一次 · 消耗 1 AP。{me.king.name==="路易十四"?"犧牲回合開始已在場兵種，恢復最多 3 HP。":"交換場上兵種與手牌；新兵種視為剛部署。"}</p><label>選擇場上兵種<select value={r21AbilityFrom} onChange={e=>setR21AbilityFrom(e.target.value)}><option value="">請選擇</option>{me.field.filter(u=>me.king.name!=="路易十四"||u.presentAtTurnStart).map(u=><option key={u.id} value={u.position}>{u.name} · {r21Positions[u.position]}</option>)}</select></label>{me.king.name==="成吉思汗"&&<label>選擇交換手牌<select value={r21AbilityCard} onChange={e=>setR21AbilityCard(e.target.value)}><option value="">請選擇</option>{me.hand.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}<p>預覽：{me.king.name==="路易十四"?`犧牲兵種，恢復 ${Math.min(3,24-me.hp)} HP`:"交換所選場上兵種與手牌"}，消耗 1 AP。</p></div><footer className="r21SpellFooter"><button onClick={()=>setR21AbilityOpen(false)}>取消</button><button disabled={!r21AbilityAvailable||!r21AbilityFrom||(me.king.name==="成吉思汗"&&!r21AbilityCard)} onClick={()=>{emit("game:r21Ability",{from:r21AbilityFrom,cardId:me.king.name==="成吉思汗"?Number(r21AbilityCard):undefined});setR21AbilityOpen(false);}}>確認發動</button></footer></section></div>}
      {isR21 && <section className="zoneCard r21AuxControls" aria-label="R2.1 回合資訊">

        {r21DeployCard && isMyTurn && <div className="r21ControlRow" role="group" aria-label="選擇部署位置"><strong>部署 {r21DeployCard.name}：</strong>{["front","center","rear"].map(pos=><button key={pos} disabled={me.field.some(u=>u.position===pos)} onClick={()=>{emit("game:deploy",{cardId:r21DeployCard.id,position:pos});setR21DeployCard(null);setR21HandOpen(false);}}>放到{({front:"前排",center:"中排",rear:"後排"})[pos]}</button>)}<button onClick={()=>setR21DeployCard(null)}>取消</button></div>}
        {mustGuard && <div role="group" aria-label="保牌回應">
          <strong>{room.pending?.attackerPlayerName} 使用「{room.pending?.attackerName}」攻擊你的國王，預計傷害 {room.pending?.damage}！請選擇保牌或承受傷害。</strong>
          <button onClick={()=>emit("game:r21Guard",{})}>不保牌，承受傷害</button>
          {me.hand.map(card=><button key={card.id} onClick={()=>emit("game:r21Guard",{cardId:card.id})}>保牌：{card.name}</button>)}
        </div>}
        {isMyTurn && <div role="group" aria-label="R2.1 行動">

          {me.king?.name==="亞歷山大大帝"&&<label className="r21KingToggle"><input type="checkbox" checked={r21Alexander&&!me.abilityUsed} disabled={!isMyTurn||me.abilityUsed||room.ap<1} onChange={e=>setR21Alexander(e.target.checked)}/>亞歷山大戰術 +1（{me.abilityUsed?"本回合已使用":"每回合一次；攻王不額外加傷害"}）</label>}
          <div className="r21CastEntry"><button type="button" onClick={()=>{setR21SpellModalOpen(true);setR21SpellError("");}}>施放魔法 · 1 AP</button><span>{room.spellUsed?"本回合已施法":`剩餘 ${room.ap} AP · 每回合一次`}</span></div>
          {r21SpellModalOpen && <div className="r21SpellBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!r21SpellBusy)resetR21Spell();}}>
            <section className="r21SpellDialog" role="dialog" aria-modal="true" aria-label="法師施法">
              <header className="r21SpellHeader"><div><h2>法師施法</h2><small>R2.1 · 1 AP · 每回合一次 · 目前 {room.ap} AP</small></div><button type="button" disabled={r21SpellBusy} onClick={resetR21Spell} aria-label="關閉施法視窗">✕</button></header>
              <div className="r21SpellBody">
                <h3>① 選擇法師</h3>
                {!r21Mages.length && <p>場上沒有法師，請先部署法師。</p>}
                <div className="r21MageGrid">{r21Mages.map(u=><button type="button" key={u.id} disabled={!!r21MageReason(u)||r21SpellBusy} aria-pressed={r21CastFrom===u.position} onClick={()=>{setR21CastFrom(u.position);setR21Spell("");setR21CastPlayerId("");setR21CastTo("");setR21SpellError("");}}><strong>{u.name}</strong><span>{r21Positions[u.position]} · {u.rank} · 1–{["初級","中級","高級"].indexOf(u.rank)+1} 級</span>{r21MageReason(u)&&<em>{r21MageReason(u)}</em>}</button>)}</div>
                {r21Caster && <><h3>② 選擇法術</h3>
                  <div className="r21SpellChoices">{r21AvailableSpells.map(([name,info])=><button type="button" key={name} disabled={r21SpellBusy} aria-pressed={r21ChosenSpell===name} onClick={()=>{setR21Spell(name);setR21CastPlayerId(info[1]==="self"?playerId:"");setR21CastTo("");setR21SpellError("");}}>{name} · {info[0]} 級</button>)}</div>
                  {r21SpellInfo && <><div className="r21SpellDescription"><h3>{r21ChosenSpell} · {r21SpellInfo[0]} 級</h3><p>{r21SpellInfo[2]}</p><p>消耗 1 AP · 每回合最多一次（{room.spellUsed?"已使用":"尚未使用"}） · 需要 {r21SpellInfo[0]} 級法師</p><p>目標：{r21SpellInfo[1]==="self"?"我方":"敵方"}{r21ChosenSpell==="流星雨"?"玩家全體初級兵種":"單一兵種"}{r21ChosenSpell==="燃血術"?" · 額外扣 3 HP":""}</p><p>施法後法師視為已行動，不能再普攻；移動消耗 AP，但不直接設定已行動。</p></div>
                    <h3>③ 選擇合法目標</h3>
                    <label>目標玩家<select value={r21CastPlayerId} disabled={r21SpellBusy||r21SpellInfo[1]==="self"} onChange={e=>{setR21CastPlayerId(e.target.value);setR21CastTo("");setR21SpellError("");}}><option value="">請選擇玩家</option>{r21SpellTargets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                    {r21ChosenSpell==="流星雨"?<p>無需選單一站位；影響所選玩家的全部初級兵種（{r21ValidUnits.length} 名）。</p>:<label>目標兵種<select value={r21CastTo} disabled={!r21CastPlayer||r21SpellBusy} onChange={e=>{setR21CastTo(e.target.value);setR21SpellError("");}}><option value="">請選擇兵種</option>{r21ValidUnits.map(u=><option key={u.id} value={u.position}>{u.name} · {r21Positions[u.position]}</option>)}</select></label>}
                    {r21CastPlayer&&!r21ValidUnits.length&&<p role="status">目前沒有合法目標，請改選法術或玩家。</p>}
                    {!r21CastBlocked&&<p className="r21SpellPreview">④ 預覽：對「{r21CastPlayer.name}」{r21ChosenSpell==="流星雨"?`的 ${r21ValidUnits.length} 名初級兵種`:`的「${r21CastUnit?.name}」`}施放「{r21ChosenSpell}」，消耗 1 AP{r21ChosenSpell==="燃血術"?" 和 3 HP":""}。</p>}
                  </>}
                </>}
                {r21CastBlocked&&<p className="r21CastWarning" role="status">{r21CastBlocked}</p>}
                {r21SpellError&&<p className="r21CastWarning" role="alert">伺服器回應：{r21SpellError}</p>}
              </div>
              <footer className="r21SpellFooter"><button type="button" disabled={r21SpellBusy} onClick={resetR21Spell}>取消／關閉</button><button type="button" className="primaryBtn" disabled={!!r21CastBlocked||r21SpellBusy} onClick={submitR21Spell}>{r21SpellBusy?"等待伺服器確認…":"確認施法 · 1 AP"}</button></footer>
            </section>
          </div>}
          <div className="r21ControlRow">
            <label>移動兵種
              <select value={r21MoveFrom} onChange={e=>setR21MoveFrom(e.target.value)}>
                <option value="">選擇兵種</option>
                {me.field.map(u=><option key={u.id} value={u.position}>{u.name}（{({front:"前排",center:"中排",rear:"後排"})[u.position]}）</option>)}
              </select>
            </label>
            {["front","center","rear"].map(pos=><button key={pos} disabled={!r21MoveFrom||r21MoveFrom===pos} onClick={()=>emit("game:r21Move",{from:r21MoveFrom,to:pos})}>移至{({front:"前排",center:"中排",rear:"後排"})[pos]}（1 AP）</button>)}
          </div>
          {(me.king?.name==="成吉思汗"||me.king?.name==="路易十四")&&<button disabled={!r21AbilityAvailable} onClick={()=>{setR21AbilityOpen(true);setR21AbilityFrom("");setR21AbilityCard("");}}>{me.king.name}能力（1 AP）{me.abilityUsed?" · 已使用":room.ap<1?" · AP 不足":""}</button>}
          {me.king?.name==="屋大維奧古斯都"&&<p>羅馬秩序：防守平手時保留兵種，該兵種下一次自己回合暫時不能攻擊；不消耗 AP。</p>}}
        </div>}
      </section>}

    </main>
  );
}

function PerformanceDebugPanel({ diagnostics }) {
  const [open, setOpen] = useState(false);
  const [metrics, setMetrics] = useState(() => diagnostics.snapshot());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open) return;
    setMetrics(diagnostics.snapshot());
    const timer = window.setInterval(() => setMetrics(diagnostics.snapshot()), 2000);
    return () => window.clearInterval(timer);
  }, [open, diagnostics]);
  const copyMetrics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(metrics, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <aside aria-label="效能診斷" style={{position:"fixed",right:10,bottom:10,zIndex:99999,
      background:"#101827",color:"#fff",border:"1px solid #8190a6",borderRadius:10,
      padding:10,maxWidth:"min(92vw,320px)",fontSize:13,boxShadow:"0 2px 15px #0008"}}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{background:"#24354e",color:"white",border:"1px solid #8190a6",
          padding:"8px 12px",borderRadius:7,cursor:"pointer"}}>
        {open ? "關閉效能診斷" : "效能診斷"}
      </button>
      {open && <>
        <p style={{margin:"8px 0"}}>僅記錄效能數字，不包含帳號、房號或卡牌資訊。</p>
        <pre style={{fontSize:11,whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:220,overflow:"auto"}}>
          {JSON.stringify(metrics,null,2)}
        </pre>
        <button type="button" onClick={copyMetrics}
          style={{background:"#24354e",color:"white",padding:"8px",borderRadius:7}}>
          {copied ? "已複製" : "複製診斷數據"}
        </button>
      </>}
    </aside>
  );
}

createRoot(document.getElementById("root")).render(<App />);
if (performanceDiagnostics) {
  const diagnosticsRoot = document.createElement("div");
  diagnosticsRoot.id = "kw-performance-diagnostics";
  document.body.appendChild(diagnosticsRoot);
  createRoot(diagnosticsRoot).render(<PerformanceDebugPanel diagnostics={performanceDiagnostics} />);
}


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
