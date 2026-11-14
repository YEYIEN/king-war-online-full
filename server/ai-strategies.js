/**
 * Distinct AI curricula and a bounded search-based research challenger.
 * All policies operate on public board state and the AI's own hand only.
 * Never access hidden cards belonging to an opponent.
 */
export const AI_PROFILES = Object.freeze({
  easy: { aim: "Learn turn flow: deploy, see combat, end turn", risk: "visible", searchDepth: 0 },
  normal: { aim: "Recognize when buffs, counters and trades matter", risk: "tactical", searchDepth: 0 },
  hard: { aim: "Plan a full tactical sequence and protect resources", risk: "strategic", searchDepth: 1 },
  conqueror: { aim: "Maximize winning chances using bounded tactical continuation search", risk: "minimax-proxy", searchDepth: 2 }
});

export function selectDeployChoice(scored, difficulty, random = Math.random) {
  if (!scored.length) return null;
  if (difficulty === "easy") {
    // Low pressure, but never deliberately choose the most expensive unhelpful option.
    const reasonable = scored.filter(x => x.score >= scored[0].score - 24);
    return reasonable[Math.floor(random() * Math.min(3, reasonable.length))] || scored[0];
  }
  return scored[0];
}

/**
 * Bounded two-action lookahead. It is NOT an exact game-tree solver:
 * archers, spell effects and opponent hidden hands are evaluated by the live
 * engine after selection. Models visible board trades and one enemy response.
 */
export function selectAttackChoice(actions, { difficulty, self, enemies, random = Math.random, battle, power, canAttack, effectiveDamage }) {
  if (!actions.length) return null;
  const valued = actions.map(action => {
    const target = enemies.find(p => p.id === action.enemy.id) || action.enemy;
    const userUnit = self.field.find(u => u.id === action.attackerId);
    if (!userUnit) return { ...action, expectedScore: -Infinity };
    const defender = action.defenderId ? target.field.find(u => u.id === action.defenderId) : null;
    let score = action.score;
    if (difficulty === "easy") {
      if (defender && battle(userUnit, defender) === "defender" && userUnit.type !== "弓兵") score -= 150;
      // Teaching AI favors short, visible battles instead of stopping with unused units.
      if (!defender) score += 10;
    } else if (difficulty === "normal") {
      if (defender && battle(userUnit, defender) === "defender" && userUnit.type !== "弓兵") score -= 130;
      if (defender && battle(userUnit, defender) === "both" && userUnit.rank === "高級" && defender.rank !== "高級") score -= 55;
      if (defender?.type === "步兵" && target.field.filter(u=>u.type === "步兵").length===1) score += 22;
    } else if (difficulty === "hard" || difficulty === "conqueror") {
      const result = defender ? battle(userUnit, defender) : "king";
      const lastGuard = defender?.type === "步兵" && target.field.filter(u=>u.type === "步兵").length===1;
      const otherReady = self.field.filter(u => u.id !== userUnit.id && canAttack(u));
      if (lastGuard && (result==="attacker" || result==="both" || userUnit.type==="弓兵")) {
        score += otherReady.reduce((sum,u)=>sum+effectiveDamage(u)*9,0);
      }
      if (!defender && target.hp <= effectiveDamage(userUnit)) score += 1000;
      if (userUnit.type==="步兵" && self.field.filter(u=>u.type==="步兵").length===1 && self.hp<=15 && result!=="attacker") score -= 100;
      if (defender && result==="defender" && userUnit.type!=="弓兵") score -= 140;
      if (difficulty === "conqueror") {
        // Bounded continuation: after a trade, which follow-up can actually hit?
        const defendersLeft = target.field.filter(u => u.id !== defender?.id);
        const cleared = !defender || result==="attacker" || result==="both" ||
          (userUnit.type==="弓兵" && power(defender) >= power(userUnit));
        const guardRemains = defendersLeft.some(u=>u.type==="步兵") || (!cleared && defender?.type==="步兵");
        if (!guardRemains) score += otherReady.reduce((sum,u)=>sum + effectiveDamage(u)*14,0);
        // Opponent's next-turn attack potential is a real cost even when the immediate trade looks attractive.
        const remainingSelfGuards = self.field.filter(u=>u.type==="步兵" && !(u.id===userUnit.id && result!=="attacker")).length;
        const dangerousEnemies = enemies.filter(p=>p.id!==self.id)
          .flatMap(p=>p.field).filter(canAttack);
        if (!remainingSelfGuards && self.hp<=15) {
          score -= dangerousEnemies.reduce((sum,u)=>sum+effectiveDamage(u),0)*8;
        }
        // Prefer recovering resources after winning tempo, rather than taking a pointless trade.
        if (defender && result==="both" && power(userUnit)>power(defender)) score -= 20;
      }
    }
    return {...action, expectedScore:score};
  }).sort((a,b)=>b.expectedScore-a.expectedScore);
  if (difficulty === "easy") {
    const shortlist = valued.filter(a=>a.expectedScore>=valued[0].expectedScore-30).slice(0,3);
    return shortlist[Math.floor(random()*shortlist.length)] || valued[0];
  }
  return valued[0];
}
