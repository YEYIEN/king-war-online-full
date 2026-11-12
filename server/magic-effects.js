// Purely local unit-field effects. Room/card ownership and caster validation live in server/index.js.
export function addStatus(unit, status) {
  if (!unit.status.includes(status)) unit.status.push(status);
}

export function freeze(unit) {
  addStatus(unit, "不能攻擊");
}

export function fireball(owner, id) {
  const index = owner.field.findIndex(unit => unit.id === id);
  if (index < 0) return;
  const unit = owner.field[index];
  if (unit.rank === "初級") owner.field.splice(index, 1);
  else addStatus(unit, "階級-1");
}

export function applyMagicFieldEffect(name, target, ids) {
  if (name === "天殞術") {
    const before = target.field.length;
    target.field = target.field.filter(unit => {
      if (unit.rank !== "高級") return false;
      freeze(unit);
      return true;
    });
    return { destroyed: before - target.field.length };
  }
  for (const id of ids) {
    const unit = target.field.find(item => item.id === id);
    if (!unit) continue;
    if (name === "火球術" || name === "流星雨") fireball(target, id);
    if (name === "冰凍術") {
      if (unit.rank === "高級") addStatus(unit, "階級-1");
      else freeze(unit);
    }
    if (name === "力量術") addStatus(unit, "力量術+1");
    if (name === "虛弱術") {
      addStatus(unit, "階級-1");
      if (unit.rank === "初級") freeze(unit);
    }
    if (name === "增強術") {
      addStatus(unit, "階級+1");
      if (!unit.tapped) addStatus(unit, "傷害+1");
    }
    if (name === "毒藥瓶") addStatus(unit, "下回合死亡");
    if (name === "燃血術") {
      addStatus(unit, "階級+1");
      addStatus(unit, "燃血+1傷害");
      unit.tapped = false;
    }
  }
  return { destroyed: 0 };
}
