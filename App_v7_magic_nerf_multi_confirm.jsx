import React, { useState } from "react";

const TYPES = ["步兵", "弓兵", "法師", "騎兵"];
const COUNTER = { 步兵: "弓兵", 弓兵: "法師", 法師: "騎兵", 騎兵: "步兵" };
const RANK_VALUE = { 初級: 1, 中級: 2, 高級: 3 };
const DAMAGE = { 初級: 1, 中級: 3, 高級: 5 };
const RANKS = ["初級", "中級", "高級"];
const MAGIC_LEVEL_RANK = { 初級魔法: "初級", 中級魔法: "中級", 高級魔法: "高級" };
const ASSET_BASE = "/king-war-assets";

const CARD_IMAGES = {
  初級步兵: `${ASSET_BASE}/cards/初級步兵_63x88mm_300dpi.png`,
  中級步兵: `${ASSET_BASE}/cards/中級步兵_63x88mm_300dpi.png`,
  高級步兵: `${ASSET_BASE}/cards/高級步兵_63x88mm_300dpi.png`,
  初級弓兵: `${ASSET_BASE}/cards/初級弓兵_63x88mm_300dpi.png`,
  中級弓兵: `${ASSET_BASE}/cards/中級弓兵_63x88mm_300dpi.png`,
  高級弓兵: `${ASSET_BASE}/cards/高級弓兵_63x88mm_300dpi.png`,
  初級法師: `${ASSET_BASE}/cards/初級法師_63x88mm_300dpi.png`,
  中級法師: `${ASSET_BASE}/cards/中級法師_63x88mm_300dpi.png`,
  高級法師: `${ASSET_BASE}/cards/高級法師_63x88mm_300dpi.png`,
  初級騎兵: `${ASSET_BASE}/cards/初級騎兵_63x88mm_300dpi.png`,
  中級騎兵: `${ASSET_BASE}/cards/中級騎兵_63x88mm_300dpi.png`,
  高級騎兵: `${ASSET_BASE}/cards/高級騎兵_63x88mm_300dpi.png`,
  火球術: `${ASSET_BASE}/cards/火球術_63x88mm_300dpi.png`,
  冰凍術: `${ASSET_BASE}/cards/冰凍術_63x88mm_300dpi.png`,
  力量術: `${ASSET_BASE}/cards/力量術_63x88mm_300dpi.png`,
  虛弱術: `${ASSET_BASE}/cards/虛弱術_63x88mm_300dpi.png`,
  增強術: `${ASSET_BASE}/cards/增強術_63x88mm_300dpi.png`,
  流星雨: `${ASSET_BASE}/cards/流星雨_63x88mm_300dpi.png`,
  毒藥瓶: `${ASSET_BASE}/cards/毒藥瓶_63x88mm_300dpi.png`,
  燃血術: `${ASSET_BASE}/cards/燃血術_63x88mm_300dpi.png`,
  天殞術: `${ASSET_BASE}/cards/天殞術_63x88mm_300dpi.png`,
};

const RULE_IMAGES = [
  `${ASSET_BASE}/rules/國王戰爭規則書封面.png`,
  `${ASSET_BASE}/rules/國王戰爭規則概要.png`,
  `${ASSET_BASE}/rules/國王戰爭規則摘要圖表.png`,
];

const PLAYMAT_IMAGE = `${ASSET_BASE}/rules/華麗的奇幻棋盤設計.png`;

const KINGS = [
  {
    name: "亞歷山大大帝",
    image: `${ASSET_BASE}/kings/亞歷山大大帝.png`,
    effectName: "征服遠征",
    effect: "每當你在戰鬥中消滅1名敵方兵種後，抽1張兵種卡。",
  },
  {
    name: "屋大維奧古斯都",
    image: `${ASSET_BASE}/kings/屋大維奧古斯都.png`,
    effectName: "羅馬秩序",
    effect: "非自己回合時，隨機1名我方場上兵種階級+1，直到你的下回合開始。",
  },
  {
    name: "成吉思汗",
    image: `${ASSET_BASE}/kings/成吉思汗.png`,
    effectName: "草原機動",
    effect: "你的回合中，可以撤回1名我方場上兵種到手牌。若撤回的是騎兵，抽1張兵種卡。",
  },
  {
    name: "秦始皇",
    image: `${ASSET_BASE}/kings/秦始皇.png`,
    effectName: "中央集權",
    effect: "你的手牌上限+2，且每回合開始時抽兵種卡數+1。",
  },
  {
    name: "路易十四",
    image: `${ASSET_BASE}/kings/路易十四.png`,
    effectName: "太陽王權",
    effect: "每回合第一次使用魔法卡後，抽1張兵種卡。",
  },
];

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function unitRules(type) {
  if (type === "步兵") return "守衛：只要防守方場上仍有步兵，敵人不能直接攻擊國王。高級兵剛部署會整備。";
  if (type === "騎兵") return "突擊：剛部署的回合即可攻擊；但高級騎兵仍須整備一回合。";
  if (type === "法師") return "施法：回合開始時依場上法師數抽魔法卡，手牌上限3。使用魔法視為一次攻擊。剛部署時不能使用同級魔法。";
  if (type === "弓兵") return "遠射：攻擊低階敵人時，第一次可再攻擊一次；攻擊同階或高階敵人時不會死亡，若攻擊高階敵人則階級-1到下回合。";
  return "";
}

function makeUnits() {
  const counts = { 初級: 7, 中級: 5, 高級: 3 };
  const deck = [];
  for (const type of TYPES) {
    for (const rank of RANKS) {
      for (let i = 0; i < counts[rank]; i++) {
        deck.push({
          id: makeId(),
          kind: "unit",
          name: `${rank}${type}`,
          type,
          rank,
          damage: DAMAGE[rank],
          counterTarget: COUNTER[type],
          tapped: false,
          justDeployed: false,
          archerBonusUsed: false,
          status: [],
        });
      }
    }
  }
  return shuffle(deck);
}

function makeMagic() {
  const list = [
    ["火球術", 2, "初級魔法", "敵方", "指定1名敵方兵種。初級直接死亡；中級或高級階級-1。"],
    ["冰凍術", 2, "初級魔法", "敵方", "指定1名敵方兵種暫停行動一回合；此效果不可疊加。"],
    ["力量術", 3, "初級魔法", "我方", "指定1名我方兵種。本回合階級+1，並重置攻擊。"],
    ["虛弱術", 2, "中級魔法", "敵方", "指定1名敵方兵種。本回合階級-1；若原本為初級，改為不能攻擊。"],
    ["增強術", 2, "中級魔法", "我方", "指定1名我方兵種。直到下回合開始前階級+1。"],
    ["流星雨", 1, "中級魔法", "敵方", "指定1至3名敵方兵種。每個目標受到加強版火球術：初級死亡；中級或高級階級-1。"],
    ["毒藥瓶", 1, "高級魔法", "敵方", "指定1名敵方兵種，放置下回合死亡標記。"],
    ["燃血術", 1, "高級魔法", "我方", "你失去3點生命值。指定1名我方兵種階級+1，並重置攻擊。"],
    ["天殞術", 1, "高級魔法", "敵方全場", "指定目標玩家。該玩家場上低於高級的兵種全部死亡；高級兵種暫停行動一回合。"],
  ];

  return shuffle(
    list.flatMap(([name, count, level, target, text]) =>
      Array.from({ length: count }, () => ({
        id: makeId(),
        kind: "magic",
        name,
        level,
        target,
        text,
      }))
    )
  );
}

function maxHand(player) {
  return player.king.name === "秦始皇" ? 9 : 7;
}

function trimHand(player, deck, game) {
  while (player.hand.length > maxHand(player)) {
    const returned = player.hand.pop();
    deck.push(returned);
    game.log = [`${player.name} 手牌超過上限，將 ${returned.name} 放回牌堆底。`, ...game.log].slice(0, 20);
  }
}

function drawUnits(game, playerIndex, amount) {
  const player = game.players[playerIndex];
  for (let i = 0; i < amount; i++) {
    if (game.unitDeck.length > 0) {
      player.hand.push(game.unitDeck.shift());
    }
  }
  trimHand(player, game.unitDeck, game);
}

function drawMagicCards(game, playerIndex, amount) {
  const player = game.players[playerIndex];
  let drawn = 0;

  for (let i = 0; i < amount; i++) {
    if (player.magic.length >= 3) break;
    if (game.magicDeck.length === 0) break;

    player.magic.push(game.magicDeck.shift());
    drawn += 1;
  }

  return drawn;
}

function createPlayers(playerCount, unitDeck, kings) {
  return Array.from({ length: playerCount }, (_, i) => {
    const king = kings[i % kings.length];
    const player = {
      name: `玩家${i + 1}`,
      king,
      hp: 30,
      hand: [],
      field: [],
      magic: [],
      magicDrawUsed: false,
      recallUsed: false,
      fieldBonus: 0,
      shield: 0,
      eliminated: false,
    };

    const initialCards = king.name === "秦始皇" ? 6 : 5;
    for (let c = 0; c < initialCards; c++) {
      if (unitDeck.length > 0) player.hand.push(unitDeck.shift());
    }
    return player;
  });
}

function createGame(playerCount) {
  const unitDeck = makeUnits();
  const magicDeck = makeMagic();
  const kings = shuffle(KINGS);
  return {
    unitDeck,
    magicDeck,
    players: createPlayers(playerCount, unitDeck, kings),
    current: 0,
    selected: null,
    pendingMagic: null,
    selectedMagic: null,
    magicCasterId: null,
    magicTargets: [],
    log: [`遊戲開始：${playerCount} 位玩家，各自抽取1張國王卡，並獲得被動效果。`],
  };
}

function clone(obj) {
  return structuredClone(obj);
}

function pushLog(g, text) {
  g.log = [text, ...g.log].slice(0, 20);
  return g;
}

function alivePlayers(players) {
  return players.filter((p) => !p.eliminated && p.hp > 0);
}

function nextAliveIndex(players, fromIndex) {
  for (let step = 1; step <= players.length; step++) {
    const next = (fromIndex + step) % players.length;
    if (!players[next].eliminated && players[next].hp > 0) return next;
  }
  return fromIndex;
}

function clearOctavianBonus(player) {
  player.field = player.field.map((unit) => ({
    ...unit,
    status: unit.status.filter((s) => s !== "屋大維+1"),
  }));
}

function applyOctavianBonus(game, playerIndex) {
  const player = game.players[playerIndex];
  if (player.king.name !== "屋大維奧古斯都") return game;

  clearOctavianBonus(player);
  const candidates = player.field.filter((unit) => !unit.status.includes("屋大維+1"));
  if (candidates.length === 0) return game;

  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  chosen.status.push("屋大維+1");
  return pushLog(game, `${player.name} 的屋大維奧古斯都效果發動：非自己回合期間，${chosen.name} 階級+1。`);
}

function startTurnFor(g, index) {
  const player = g.players[index];

  clearOctavianBonus(player);
  player.magicDrawUsed = false;
  player.recallUsed = false;
  player.fieldBonus = 0;
  player.field = player.field.map((unit) => ({
    ...unit,
    tapped: false,
    justDeployed: false,
    archerBonusUsed: false,
    status: unit.status.filter((s) => s !== "階級+1" && s !== "階級-1" && s !== "整備"),
  }));

  const drawAmount = player.king.name === "秦始皇" ? 2 : 1;
  drawUnits(g, index, drawAmount);

  const mageCount = player.field.filter((unit) => unit.type === "法師").length;
  const magicDrawn = drawMagicCards(g, index, mageCount);

  let message = `${player.name} 回合開始，抽${drawAmount}張兵種卡。`;
  if (mageCount > 0) {
    message += ` 場上有${mageCount}名法師，抽${magicDrawn}張魔法卡（魔法手牌上限3）。`;
  }

  return pushLog(g, message);
}

function mageCanCast(mage, magic) {
  if (!mage || mage.type !== "法師") return false;
  if (mage.tapped || mage.status.includes("不能攻擊")) return false;
  if (mage.justDeployed && mage.rank === MAGIC_LEVEL_RANK[magic.level]) return false;

  if (magic.level === "初級魔法") return ["初級", "中級", "高級"].includes(mage.rank);
  if (magic.level === "中級魔法") return ["中級", "高級"].includes(mage.rank);
  if (magic.level === "高級魔法") return mage.rank === "高級";
  return false;
}

function hasAvailableCaster(player, magic) {
  return player.field.some((unit) => mageCanCast(unit, magic));
}

function rankPower(unit) {
  let value = RANK_VALUE[unit.rank];
  if (unit.status.includes("階級+1")) value += 1;
  if (unit.status.includes("屋大維+1")) value += 1;
  if (unit.status.includes("整備")) value -= 1;
  if (unit.status.includes("階級-1")) value -= 1;
  return value;
}

function battleResult(attacker, defender) {
  let a = rankPower(attacker);
  let d = rankPower(defender);

  if (attacker.counterTarget === defender.type) a += 1;
  if (defender.counterTarget === attacker.type) d += 1;

  if (a > d) return "attacker";
  if (d > a) return "defender";
  return "both";
}

function canUnitAttack(unit) {
  if (unit.tapped) return false;
  if (unit.status.includes("不能攻擊")) return false;
  if (unit.status.includes("整備")) return false;
  if (unit.justDeployed && unit.type !== "騎兵") return false;
  return true;
}

function Card({ card, onClick, selected, disabled }) {
  const image = CARD_IMAGES[card.name];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles.card,
        opacity: disabled ? 0.45 : 1,
        border: selected ? "4px solid #22c55e" : "1px solid #475569",
      }}
    >
      {image ? (
        <img
          src={image}
          alt={card.name}
          style={styles.cardImage}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}

      <div style={styles.cardName}>{card.name}</div>

      {card.kind === "unit" ? (
        <>
          <div style={styles.cardMeta}>
            傷害 {card.damage}｜剋 {card.counterTarget}｜{canUnitAttack(card) ? "可攻擊" : card.tapped ? "已行動" : "待命"}
          </div>
          <div style={styles.unitRule}>{unitRules(card.type)}</div>
          {card.status.length > 0 ? (
            <div style={styles.status}>
              {card.status.map((s) => (s === "屋大維+1" ? "屋大維加護：階級+1" : s)).join("、")}
            </div>
          ) : null}
        </>
      ) : (
        <div style={styles.cardMeta}>
          {card.level}｜目標：{card.target}
          <br />
          {card.text}
        </div>
      )}
    </button>
  );
}

function KingCard({ king }) {
  return (
    <div style={styles.kingCard}>
      <img
        src={king.image}
        alt={king.name}
        style={styles.kingImage}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      <div style={styles.kingName}>{king.name}</div>
      <div style={styles.kingEffect}>
        <strong>{king.effectName}：</strong>
        {king.effect}
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section style={styles.panel}>
      <h2 style={styles.panelTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }) {
  return <div style={styles.grid}>{children}</div>;
}

function RuleModal({ onClose }) {
  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={{ margin: 0 }}>遊戲規則</h2>
          <button style={styles.grayButton} onClick={onClose}>關閉</button>
        </div>
        <div style={styles.ruleImages}>
          {RULE_IMAGES.map((src) => (
            <img key={src} src={src} alt="規則" style={styles.ruleImage} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MagicConfirmModal({ magic, onYes, onNo }) {
  return (
    <div style={styles.modalBackdrop} onClick={onNo}>
      <div style={styles.magicModal} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>是否使用這張魔法卡？</h2>
        <Card card={magic} />
        <div style={{ ...styles.actions, marginTop: 16, justifyContent: "center" }}>
          <button style={styles.greenButton} onClick={onYes}>是，使用</button>
          <button style={styles.grayButton} onClick={onNo}>否，取消</button>
        </div>
      </div>
    </div>
  );
}


function magicTargetLimit(magic) {
  if (!magic) return 0;
  if (magic.name === "流星雨") return 3;
  if (magic.name === "天殞術") return 0;
  return 1;
}

function fireballLikeEffect(owner, unitId) {
  const idx = owner.field.findIndex((u) => u.id === unitId);
  if (idx < 0) return false;
  const unit = owner.field[idx];

  if (unit.rank === "初級") {
    owner.field.splice(idx, 1);
    return true;
  }

  unit.status.push("階級-1");
  return false;
}

function freezeUnitOnce(unit) {
  if (!unit.status.includes("不能攻擊")) {
    unit.status.push("不能攻擊");
    return true;
  }
  return false;
}

export default function App() {
  const [playerCount, setPlayerCount] = useState(2);
  const [showRules, setShowRules] = useState(false);
  const [game, setGame] = useState(null);
  const [targetIndex, setTargetIndex] = useState(1);

  if (!game) {
    return (
      <div style={styles.startPage}>
        {showRules && <RuleModal onClose={() => setShowRules(false)} />}

        <div style={styles.startCard}>
          <h1 style={styles.bigTitle}>國王戰爭</h1>
          <p style={styles.subtitle}>電腦版原型｜2–5 人熱座模式｜橫版介面</p>

          <img
            src={PLAYMAT_IMAGE}
            alt="玩家場地墊"
            style={styles.startImage}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />

          <label style={styles.label}>玩家人數</label>
          <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))} style={styles.select}>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} 人</option>
            ))}
          </select>

          <div style={styles.actions}>
            <button style={styles.greenButton} onClick={() => setGame(startTurnFor(createGame(playerCount), 0))}>開始遊戲</button>
            <button style={styles.blueButton} onClick={() => setShowRules(true)}>查看遊戲規則</button>
          </div>
        </div>
      </div>
    );
  }

  const me = game.players[game.current];
  const legalTargets = game.players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== game.current && !p.eliminated && p.hp > 0);

  const enemy =
    game.players[targetIndex] && targetIndex !== game.current && !game.players[targetIndex].eliminated
      ? game.players[targetIndex]
      : legalTargets[0]?.p;

  const actualTargetIndex = enemy ? game.players.findIndex((p) => p === enemy) : -1;
  const gameOver = alivePlayers(game.players).length <= 1;
  const winner = gameOver ? alivePlayers(game.players)[0] : null;
  const pendingMagic = me.magic.find((m) => m.id === game.pendingMagic);
  const selectedMagic = me.magic.find((m) => m.id === game.selectedMagic);
  const magicCaster = me.field.find((u) => u.id === game.magicCasterId);
  const selectedTargetCount = game.magicTargets?.length || 0;
  const currentMagicLimit = magicTargetLimit(pendingMagic);
  const canConfirmMagic =
    !!pendingMagic &&
    !!magicCaster &&
    (pendingMagic.name === "天殞術" || selectedTargetCount >= 1);

  function backToMenu() {
    setGame(null);
    setTargetIndex(1);
  }

  function endTurn() {
    if (gameOver) return;

    let g = clone(game);
    const p = g.current;
    const player = g.players[p];

    player.field = player.field.filter((u) => !u.status.includes("下回合死亡"));
    player.fieldBonus = 0;
    trimHand(player, g.unitDeck, g);
    g = applyOctavianBonus(g, p);

    g.selected = null;
    g.pendingMagic = null;
    g.selectedMagic = null;
    g.magicCasterId = null;
    g.magicTargets = [];
    g.current = nextAliveIndex(g.players, p);

    g = pushLog(g, `${player.name} 回合結束。`);
    g = startTurnFor(g, g.current);

    setTargetIndex(nextAliveIndex(g.players, g.current));
    setGame(g);
  }

  function deployUnit(cardId) {
    if (gameOver || pendingMagic) return;

    let g = clone(game);
    const player = g.players[g.current];
    const index = player.hand.findIndex((c) => c.id === cardId);

    if (index < 0) return;

    const maxField = 5 + player.fieldBonus;

    if (player.field.length >= maxField) {
      setGame(pushLog(g, "場上兵種區已滿，不能再部署。"));
      return;
    }

    const [card] = player.hand.splice(index, 1);
    card.justDeployed = true;

    if (card.rank === "高級") {
      card.status.push("整備");
      card.tapped = true;
    } else {
      card.tapped = card.type === "騎兵" ? false : true;
    }

    player.field.push(card);

    let message = `${player.name} 部署 ${card.name}。`;

    if (card.rank === "高級") {
      message += " 高級兵種進入整備狀態：本回合不能攻擊，若被攻擊則階級-1，到下回合開始解除。";
    } else if (card.type === "騎兵") {
      message += " 騎兵可立即攻擊。";
    } else {
      message += " 此兵種需等到下回合開始才能攻擊。";
    }

    if (card.type === "法師") {
      message += " 魔法卡改為在回合開始時依場上法師數量抽取。";
    }

    setGame(pushLog(g, message));
  }

  function recallUnit(unitId) {
    if (gameOver || pendingMagic) return;

    let g = clone(game);
    const player = g.players[g.current];

    if (player.king.name !== "成吉思汗") {
      setGame(pushLog(g, "只有成吉思汗可以使用撤回兵種。"));
      return;
    }

    if (player.recallUsed) {
      setGame(pushLog(g, "本回合已經撤回過1名兵種。"));
      return;
    }

    const index = player.field.findIndex((u) => u.id === unitId);
    if (index < 0) return;

    const [unit] = player.field.splice(index, 1);
    unit.tapped = false;
    unit.justDeployed = false;
    player.hand.push(unit);
    player.recallUsed = true;

    let message = `${player.name} 發動成吉思汗效果，撤回 ${unit.name} 到手牌。`;

    if (unit.type === "騎兵") {
      drawUnits(g, g.current, 1);
      message += " 因撤回騎兵，抽1張兵種卡。";
    }

    setGame(pushLog(g, message));
  }

  function openMagic(cardId) {
    const magic = me.magic.find((m) => m.id === cardId);
    if (!magic) return;

    if (!hasAvailableCaster(me, magic)) {
      setGame(pushLog(clone(game), `不能使用 ${magic.name}：沒有可施放此魔法的未行動法師。`));
      return;
    }

    setGame({ ...game, selectedMagic: cardId });
  }

  function confirmMagicUse() {
    setGame({
      ...game,
      pendingMagic: game.selectedMagic,
      selectedMagic: null,
      magicCasterId: null,
      magicTargets: [],
    });
  }

  function cancelMagicUse() {
    setGame({
      ...game,
      selectedMagic: null,
      pendingMagic: null,
      magicCasterId: null,
      magicTargets: [],
    });
  }

  function chooseMagicCaster(unitId) {
    const magic = pendingMagic;
    if (!magic) return;

    const mage = me.field.find((u) => u.id === unitId);
    if (!mageCanCast(mage, magic)) {
      setGame(pushLog(clone(game), "這名法師不能施放此魔法：可能已行動、階級不足，或剛部署且使用同級魔法。"));
      return;
    }

    setGame({
      ...game,
      magicCasterId: unitId,
    });
  }

  function toggleMagicTarget(ownerIndex, unitId) {
    if (!pendingMagic || !magicCaster) return;

    const shouldTargetSelf = pendingMagic.target === "我方";
    const targetEnemy = pendingMagic.target === "敵方" || pendingMagic.target === "敵方全場";

    if (pendingMagic.name === "天殞術") {
      setGame(pushLog(clone(game), "天殞術不需要點選單一兵種，確認後會影響目前選擇的目標玩家全場。"));
      return;
    }

    if (shouldTargetSelf && ownerIndex !== game.current) return;
    if (targetEnemy && ownerIndex === game.current) return;

    const limit = magicTargetLimit(pendingMagic);
    const exists = game.magicTargets.some((t) => t.ownerIndex === ownerIndex && t.unitId === unitId);

    let nextTargets = [...game.magicTargets];

    if (exists) {
      nextTargets = nextTargets.filter((t) => !(t.ownerIndex === ownerIndex && t.unitId === unitId));
    } else {
      if (limit === 1) {
        nextTargets = [{ ownerIndex, unitId }];
      } else if (nextTargets.length < limit) {
        nextTargets.push({ ownerIndex, unitId });
      }
    }

    setGame({
      ...game,
      magicTargets: nextTargets,
    });
  }

  function confirmMagicTargets() {
    if (!pendingMagic || !magicCaster) return;

    const limit = magicTargetLimit(pendingMagic);

    if (pendingMagic.name !== "天殞術" && game.magicTargets.length < 1) {
      setGame(pushLog(clone(game), "請至少指定1個魔法目標。"));
      return;
    }

    if (pendingMagic.name === "流星雨" && game.magicTargets.length > 3) {
      setGame(pushLog(clone(game), "流星雨最多只能指定3個目標。"));
      return;
    }

    let g = clone(game);
    const p = g.current;
    const player = g.players[p];
    const caster = player.field.find((u) => u.id === game.magicCasterId);
    const magicIndex = player.magic.findIndex((m) => m.id === pendingMagic.id);

    if (!caster || magicIndex < 0) return;

    const magic = player.magic[magicIndex];
    player.magic.splice(magicIndex, 1);
    caster.tapped = true;
    g.magicDeck.push(magic);

    let detail = "";

    if (magic.name === "天殞術") {
      const owner = g.players[actualTargetIndex];

      if (!owner) return;

      const before = owner.field.length;
      owner.field = owner.field.filter((unit) => {
        if (unit.rank !== "高級") return false;
        freezeUnitOnce(unit);
        return true;
      });

      const dead = before - owner.field.length;
      detail = `低於高級的兵種死亡${dead}名，高級兵種暫停行動一回合。`;
    } else {
      const targets = game.magicTargets.slice(0, limit);

      for (const target of targets) {
        const owner = g.players[target.ownerIndex];
        const idx = owner.field.findIndex((u) => u.id === target.unitId);
        if (idx < 0) continue;

        const unit = owner.field[idx];

        if (magic.name === "火球術") {
          fireballLikeEffect(owner, target.unitId);
        }

        if (magic.name === "冰凍術") {
          freezeUnitOnce(unit);
        }

        if (magic.name === "力量術") {
          unit.status.push("階級+1");
          unit.tapped = false;
        }

        if (magic.name === "虛弱術") {
          unit.status.push("階級-1");
          if (unit.rank === "初級") freezeUnitOnce(unit);
        }

        if (magic.name === "增強術") {
          unit.status.push("階級+1");
        }

        if (magic.name === "毒藥瓶") {
          unit.status.push("下回合死亡");
        }

        if (magic.name === "燃血術") {
          player.hp -= 3;
          unit.status.push("階級+1");
          unit.tapped = false;
        }

        if (magic.name === "流星雨") {
          fireballLikeEffect(owner, target.unitId);
        }
      }

      detail = `指定${targets.length}個目標。`;
    }

    if (player.king.name === "路易十四" && !player.magicDrawUsed) {
      drawUnits(g, p, 1);
      player.magicDrawUsed = true;
      g = pushLog(g, `${player.name} 的路易十四效果發動：使用魔法後抽1張兵種卡。`);
    }

    g.pendingMagic = null;
    g.selectedMagic = null;
    g.magicCasterId = null;
    g.magicTargets = [];

    setGame(pushLog(g, `${player.name} 使用 ${caster.name} 施放魔法卡：${magic.name}。${detail}`));
  }

  function selectOwnUnit(unitId) {
    if (pendingMagic && !magicCaster) {
      chooseMagicCaster(unitId);
      return;
    }

    if (pendingMagic && magicCaster && pendingMagic.target === "我方") {
      toggleMagicTarget(game.current, unitId);
      return;
    }

    const unit = me.field.find((u) => u.id === unitId);
    if (!unit || !canUnitAttack(unit)) return;

    setGame({ ...game, selected: unitId });
  }

  function attackUnit(defenderId) {
    if (pendingMagic && magicCaster && (pendingMagic.target === "敵方" || pendingMagic.target === "敵方全場")) {
      toggleMagicTarget(actualTargetIndex, defenderId);
      return;
    }

    if (!game.selected || gameOver || actualTargetIndex < 0) return;

    let g = clone(game);
    const p = g.current;
    const e = actualTargetIndex;

    const aIndex = g.players[p].field.findIndex((u) => u.id === g.selected);
    const dIndex = g.players[e].field.findIndex((u) => u.id === defenderId);

    if (aIndex < 0 || dIndex < 0) return;

    const attacker = g.players[p].field[aIndex];
    const defender = g.players[e].field[dIndex];

    if (!canUnitAttack(attacker)) return;

    const attackerPowerBefore = rankPower(attacker);
    const defenderPowerBefore = rankPower(defender);
    const result = battleResult(attacker, defender);

    attacker.tapped = true;

    let killedEnemy = false;
    let archerSaved = false;
    let archerExtraAttack = false;

    if (attacker.type === "弓兵") {
      if (defenderPowerBefore < attackerPowerBefore && !attacker.archerBonusUsed) {
        archerExtraAttack = true;
      }

      if (defenderPowerBefore >= attackerPowerBefore) {
        archerSaved = true;
        if (defenderPowerBefore > attackerPowerBefore) attacker.status.push("階級-1");
      }
    }

    if (result === "attacker") {
      g.players[e].field.splice(dIndex, 1);
      killedEnemy = true;
    } else if (result === "defender") {
      if (!archerSaved) g.players[p].field.splice(aIndex, 1);
    } else {
      g.players[e].field.splice(dIndex, 1);
      killedEnemy = true;
      if (!archerSaved) g.players[p].field.splice(aIndex, 1);
    }

    const survivingAttacker = g.players[p].field.find((u) => u.id === attacker.id);
    if (survivingAttacker && archerExtraAttack) {
      survivingAttacker.tapped = false;
      survivingAttacker.archerBonusUsed = true;
      g = pushLog(g, `${survivingAttacker.name} 的弓兵效果發動：面對較低階敵人，獲得一次額外攻擊。`);
    }

    if (killedEnemy && g.players[p].king.name === "亞歷山大大帝") {
      drawUnits(g, p, 1);
      g = pushLog(g, `${g.players[p].name} 的亞歷山大大帝效果發動：消滅敵軍後抽1張兵種卡。`);
    }

    g.selected = null;

    const resultText =
      result === "attacker" ? "攻擊方勝" :
      result === "defender" ? (archerSaved ? "防守方勝，但弓兵不死亡" : "防守方勝") :
      archerSaved ? "雙方相持，弓兵不死亡" :
      "雙方死亡";

    setGame(pushLog(g, `${attacker.name} 攻擊 ${g.players[e].name} 的 ${defender.name}，${resultText}。`));
  }

  function attackKing() {
    if (!game.selected || gameOver || actualTargetIndex < 0) return;

    let g = clone(game);
    const p = g.current;
    const e = actualTargetIndex;

    if (g.players[e].field.some((u) => u.type === "步兵")) {
      setGame(pushLog(g, `${g.players[e].name} 場上仍有步兵，必須先消滅步兵才能攻擊國王。`));
      return;
    }

    const attacker = g.players[p].field.find((u) => u.id === g.selected);
    if (!attacker || !canUnitAttack(attacker)) return;

    let damage = attacker.damage;

    if (g.players[e].shield > 0) {
      const reduce = Math.min(g.players[e].shield, damage);
      damage -= reduce;
      g.players[e].shield = 0;
    }

    g.players[e].hp -= damage;

    if (g.players[e].hp <= 0) {
      g.players[e].eliminated = true;
    }

    attacker.tapped = true;
    g.selected = null;

    setGame(pushLog(g, `${attacker.name} 攻擊 ${g.players[e].name} 國王，造成 ${damage} 傷害。`));
  }

  return (
    <div style={styles.page}>
      {showRules && <RuleModal onClose={() => setShowRules(false)} />}
      {selectedMagic && <MagicConfirmModal magic={selectedMagic} onYes={confirmMagicUse} onNo={cancelMagicUse} />}

      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>國王戰爭｜電腦版</h1>
          <p style={styles.subtitle}>
            {pendingMagic && !magicCaster
              ? `請先指定施放 ${pendingMagic.name} 的法師`
              : pendingMagic && magicCaster
              ? `施法者：${magicCaster.name}。請指定 ${pendingMagic.name} 的目標：${pendingMagic.target}，完成後按確認。`
              : `現在回合：${me.name}`}
          </p>
        </div>

        <div style={styles.actions}>
          <button style={styles.blueButton} onClick={() => setShowRules(true)}>遊戲規則</button>
          <button style={styles.greenButton} onClick={endTurn}>結束回合 → 下一位</button>
          <button style={styles.grayButton} onClick={backToMenu}>回主選單</button>
        </div>
      </header>

      <div style={styles.playerGrid}>
        {game.players.map((p, index) => (
          <div
            key={p.name}
            style={{
              ...styles.playerBox,
              opacity: p.eliminated ? 0.45 : 1,
              borderColor: index === game.current ? "#34d399" : "#334155",
              background: index === game.current ? "#064e3b" : "#0f172a",
            }}
          >
            <div style={styles.playerTop}>
              <h2 style={{ margin: 0 }}>{p.name}{index === game.current ? "｜目前回合" : ""}</h2>
              <strong style={styles.hp}>HP {p.hp}</strong>
            </div>

            <div style={styles.meta}>
              手牌 {p.hand.length}/{maxHand(p)}｜魔法 {p.magic.length}/3｜場上 {p.field.length}/5｜{p.eliminated ? "出局" : "存活"}
            </div>

            <KingCard king={p.king} />
          </div>
        ))}
      </div>

      {winner && <div style={styles.winner}>{winner.name} 獲勝！</div>}

      <main style={styles.main}>
        <div style={styles.left}>
          <Panel title="選擇目標玩家">
            <select value={actualTargetIndex} onChange={(e) => setTargetIndex(Number(e.target.value))} style={styles.select}>
              {legalTargets.map(({ p, i }) => (
                <option key={p.name} value={i}>{p.name}</option>
              ))}
            </select>
          </Panel>

          {pendingMagic && magicCaster ? (
            <Panel title="魔法目標確認">
              <div style={{ color: "#cbd5e1", lineHeight: 1.7 }}>
                目前魔法：<strong>{pendingMagic.name}</strong><br />
                施法者：<strong>{magicCaster.name}</strong><br />
                {pendingMagic.name === "天殞術"
                  ? `效果將作用於 ${enemy?.name || "目標玩家"} 全場，不需要點選單一兵種。`
                  : `已指定 ${selectedTargetCount}/${currentMagicLimit} 個目標。`}
              </div>
              <div style={{ ...styles.actions, marginTop: 12 }}>
                <button style={styles.greenButton} onClick={confirmMagicTargets} disabled={!canConfirmMagic}>
                  確認施放
                </button>
                <button style={styles.grayButton} onClick={cancelMagicUse}>
                  取消施法
                </button>
              </div>
            </Panel>
          ) : null}

          <Panel title={`${enemy?.name || "敵方"} 場上｜${(pendingMagic?.target === "敵方" || pendingMagic?.target === "敵方全場") ? "點選魔法目標" : "點選可攻擊目標"}`}>
            <Grid>
              {enemy?.field.map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  onClick={() => attackUnit(card.id)}
                  selected={game.magicTargets?.some((t) => t.ownerIndex === actualTargetIndex && t.unitId === card.id)}
                  disabled={pendingMagic && (!magicCaster || pendingMagic.target === "我方" || pendingMagic.name === "天殞術")}
                />
              ))}
            </Grid>
          </Panel>

          <Panel title={`我方場上｜${pendingMagic ? (!magicCaster ? "點選施法法師" : pendingMagic.target === "我方" ? "點選魔法目標" : "等待指定敵方目標") : "先點選攻擊者"}`}>
            <button style={styles.redButton} onClick={attackKing} disabled={!!pendingMagic}>
              攻擊目標玩家國王
            </button>

            <div style={{ height: 12 }} />

            <Grid>
              {me.field.map((card) => (
                <div key={card.id} style={styles.cardWrapper}>
                  <Card
                    card={card}
                    selected={game.selected === card.id || game.magicCasterId === card.id || game.magicTargets?.some((t) => t.ownerIndex === game.current && t.unitId === card.id)}
                    onClick={() => selectOwnUnit(card.id)}
                    disabled={pendingMagic && magicCaster && pendingMagic.target !== "我方"}
                  />

                  {me.king.name === "成吉思汗" && !me.recallUsed && !pendingMagic ? (
                    <button style={styles.recallButton} onClick={() => recallUnit(card.id)}>
                      撤回
                    </button>
                  ) : null}
                </div>
              ))}
            </Grid>
          </Panel>

          <Panel title="兵種手牌｜點選部署">
            <Grid>
              {me.hand.map((card) => (
                <Card key={card.id} card={card} onClick={() => deployUnit(card.id)} disabled={!!pendingMagic} />
              ))}
            </Grid>
          </Panel>
        </div>

        <aside style={styles.right}>
          <Panel title="魔法卡｜點選後確認使用">
            <div style={styles.verticalList}>
              {me.magic.map((card) => (
                <Card key={card.id} card={card} onClick={() => openMagic(card.id)} disabled={!!pendingMagic} />
              ))}
            </div>
          </Panel>

          <Panel title="兵種相剋">
            <div style={{ lineHeight: 1.8 }}>
              步兵 → 弓兵
              <br />
              弓兵 → 法師
              <br />
              法師 → 騎兵
              <br />
              騎兵 → 步兵
            </div>
          </Panel>

          <Panel title="遊戲紀錄">
            <div style={styles.logBox}>
              {game.log.map((line, i) => (
                <div key={i} style={styles.logLine}>{line}</div>
              ))}
            </div>
          </Panel>
        </aside>
      </main>
    </div>
  );
}

const styles = {
  startPage: {
    minHeight: "100vh",
    background: "#020617",
    color: "#f8fafc",
    display: "grid",
    placeItems: "center",
    padding: 24,
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  startCard: {
    width: "min(860px, 100%)",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 24,
    padding: 28,
    boxShadow: "0 20px 80px rgba(0,0,0,0.35)",
  },
  bigTitle: {
    fontSize: 54,
    margin: 0,
    fontWeight: 950,
  },
  startImage: {
    width: "100%",
    borderRadius: 18,
    margin: "18px 0",
    border: "1px solid #334155",
  },
  page: {
    minHeight: "100vh",
    background: "#020617",
    color: "#f8fafc",
    padding: 24,
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    maxWidth: 1700,
    margin: "0 auto 20px",
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    alignItems: "center",
  },
  title: {
    margin: 0,
    fontSize: 40,
    fontWeight: 900,
  },
  subtitle: {
    color: "#cbd5e1",
    marginTop: 8,
  },
  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  label: {
    display: "block",
    marginTop: 12,
    marginBottom: 8,
    color: "#cbd5e1",
    fontWeight: 800,
  },
  select: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #475569",
    background: "#0f172a",
    color: "white",
    fontWeight: 800,
    minWidth: 160,
  },
  playerGrid: {
    maxWidth: 1700,
    margin: "0 auto 20px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 14,
  },
  playerBox: {
    border: "2px solid",
    borderRadius: 18,
    padding: 14,
  },
  playerTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  hp: {
    color: "#fecaca",
    fontSize: 28,
  },
  meta: {
    marginTop: 8,
    color: "#cbd5e1",
    fontSize: 14,
  },
  kingCard: {
    marginTop: 12,
    background: "#111827",
    border: "1px solid #475569",
    borderRadius: 14,
    padding: 10,
  },
  kingImage: {
    width: "100%",
    height: "auto",
    objectFit: "contain",
    borderRadius: 10,
    marginBottom: 8,
    display: "block",
    background: "#020617",
  },
  kingName: {
    fontWeight: 900,
    fontSize: 18,
    marginBottom: 4,
  },
  kingEffect: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 1.55,
  },
  winner: {
    maxWidth: 1700,
    margin: "0 auto 20px",
    background: "#fde047",
    color: "#1e293b",
    padding: 18,
    borderRadius: 16,
    fontSize: 28,
    fontWeight: 900,
  },
  main: {
    maxWidth: 1700,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 390px",
    gap: 18,
  },
  left: {
    display: "grid",
    gap: 18,
  },
  right: {
    display: "grid",
    gap: 18,
    alignContent: "start",
  },
  panel: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 16,
  },
  panelTitle: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 22,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: 12,
  },
  verticalList: {
    display: "grid",
    gap: 10,
  },
  cardWrapper: {
    display: "grid",
    gap: 6,
  },
  card: {
    textAlign: "left",
    borderRadius: 14,
    padding: 8,
    minHeight: 160,
    cursor: "pointer",
    background: "#0b1220",
    color: "#f8fafc",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    overflow: "hidden",
  },
  cardImage: {
    width: "100%",
    borderRadius: 10,
    display: "block",
    marginBottom: 8,
  },
  cardName: {
    fontSize: 18,
    fontWeight: 900,
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 12,
    color: "#cbd5e1",
    lineHeight: 1.45,
  },
  unitRule: {
    marginTop: 6,
    fontSize: 11,
    color: "#fde68a",
    lineHeight: 1.45,
  },
  status: {
    marginTop: 4,
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: 900,
  },
  recallButton: {
    border: "none",
    borderRadius: 10,
    padding: "8px 10px",
    background: "#a16207",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
  },
  logBox: {
    display: "grid",
    gap: 8,
    maxHeight: 300,
    overflowY: "auto",
    color: "#cbd5e1",
    fontSize: 14,
  },
  logLine: {
    borderBottom: "1px solid #334155",
    paddingBottom: 6,
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    zIndex: 50,
    display: "grid",
    placeItems: "center",
    padding: 20,
  },
  modal: {
    width: "min(1000px, 96vw)",
    maxHeight: "92vh",
    overflowY: "auto",
    background: "#0f172a",
    border: "1px solid #475569",
    borderRadius: 22,
    padding: 18,
  },
  magicModal: {
    width: "min(430px, 96vw)",
    maxHeight: "92vh",
    overflowY: "auto",
    background: "#0f172a",
    border: "1px solid #475569",
    borderRadius: 22,
    padding: 18,
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  ruleImages: {
    display: "grid",
    gap: 14,
  },
  ruleImage: {
    width: "100%",
    borderRadius: 14,
    border: "1px solid #334155",
  },
  greenButton: button("#22c55e"),
  blueButton: button("#3b82f6"),
  grayButton: button("#64748b"),
  redButton: button("#ef4444"),
};

function button(background) {
  return {
    border: "none",
    borderRadius: 12,
    padding: "10px 14px",
    background,
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 15,
  };
}
