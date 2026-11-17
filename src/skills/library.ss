// ============================================================
// SkillScript 技能库（20 个技能）
// 约定：暴击率/暴击伤害/闪避均为百分数字面量；元素倍率由 element_mult 查表。
// ============================================================

// ---------- 1. 烈焰斩：基础攻击 + 暴击 + 元素克制 ----------
skill flame_slash {
  let base = stat(caster, "atk") - stat(target, "def") * 0.5;
  let mult = element_mult("fire", target.element);
  let dmg = base * mult;
  let is_crit = stat(caster, "critRate") >= 50;
  if (is_crit) {
    dmg = dmg * (1 + stat(caster, "critDmg") / 100);
    log("烈焰斩触发暴击", "crit");
  }
  damage(caster, target, dmg, "fire");
}

// ---------- 2. 强力一击：条件分支，目标半血以下增伤 30% ----------
skill power_strike {
  let ratio = target.hp / stat(target, "maxHp");
  let dmg = stat(caster, "atk") * 1.2 - stat(target, "def") * 0.5;
  if (ratio < 0.5) {
    dmg = dmg * 1.3;
    log("目标残血，强力一击增伤 30%");
  }
  damage(caster, target, dmg, "phys");
}

// ---------- 3. 重击：消耗 20 法力，法力不足只打 70% ----------
skill heavy_blow {
  let dmg = stat(caster, "atk") * 1.6 - stat(target, "def") * 0.6;
  if (caster.mp >= 20) {
    add_mp(caster, -20);
    dmg = dmg * 1.25;
    log("重击消耗 20 法力并强化", "info");
  } else {
    dmg = dmg * 0.7;
    log("法力不足，重击威力下降", "info");
  }
  damage(caster, target, dmg, "phys");
}

// ---------- 4. 治疗术：恢复目标 80% 法强的生命 ----------
skill heal_light {
  let amount = stat(caster, "atk") * 0.8 + 30;
  let healed = heal(caster, target, amount);
  log("治疗术恢复 " + healed + " 点生命", "heal");
}

// ---------- 5. 荆棘护体（被动）：受击反弹 20% 伤害 ----------
skill thorns_aura {
  on "take_hit" {
    let reflect = damage_amount * 0.2;
    damage(target, attacker, reflect, "phys");
    log("荆棘反弹 " + reflect + " 点伤害");
  }
}

// ---------- 6. 怒意（被动）：每次受击攻击力 +5（叠层 buff） ----------
skill rage_heart {
  on "take_hit" {
    add_buff(target, "rage", target);
  }
}
buff rage {
  set_stacking("stack");
  set_max_stacks(5);
  set_duration(99);
  mod_stat("atk", 5, "flat");
}

// ---------- 7. 恢复结界：获得 3 回合恢复，每回合开始回血 ----------
skill regeneration {
  add_buff(target, "regen", caster);
}
buff regen {
  set_stacking("refresh");
  set_duration(3);
  on "turn_start" {
    let amount = stat(source, "atk") * 0.2 + 10;
    heal(source, owner, amount);
  }
}

// ---------- 8. 灼烧：3 回合持续火焰伤害（可叠层，每层独立伤害） ----------
skill burn_dot {
  add_buff(target, "burn", caster);
}
buff burn {
  set_stacking("stack");
  set_max_stacks(3);
  set_duration(3);
  on "turn_start" {
    damage(source, owner, 12 * buff_stacks(owner, "burn"), "fire");
    log("灼烧造成持续伤害", "damage");
  }
}

// ---------- 9. 毒镖：可无限叠加的中毒，每层 6 点 ----------
skill poison_dart {
  damage(caster, target, 20, "phys");
  add_buff(target, "poison", caster);
}
buff poison {
  set_stacking("stack");
  set_max_stacks(99);
  set_duration(3);
  on "turn_start" {
    damage(source, owner, 6 * buff_stacks(owner, "poison"), "phys");
  }
}

// ---------- 10. 奥术护盾：刷新规则，再施放只续期不叠加 ----------
skill arcane_shield {
  add_buff(target, "shield", caster);
}
buff shield {
  set_stacking("refresh");
  set_duration(2);
  mod_stat("def", 20, "flat");
}

// ---------- 11. 三连击：while 循环打 3 段，每段 45% 攻击力 ----------
skill combo_strike {
  let hits = 0;
  let total = 0;
  while (hits < 3) {
    let dmg = stat(caster, "atk") * 0.45 - stat(target, "def") * 0.2;
    total = total + damage(caster, target, dmg, "phys");
    hits = hits + 1;
  }
  log("三连击累计造成 " + total + " 点伤害", "damage");
}

// ---------- 12. 处决：目标低于 25% 血量时造成 9999 点真实伤害 ----------
skill execute {
  let ratio = target.hp / stat(target, "maxHp");
  if (ratio <= 0.25) {
    damage(caster, target, 9999, "none");
    log("处决成功", "damage");
  } else {
    damage(caster, target, stat(caster, "atk") * 0.8, "phys");
    log("处决条件不满足，造成普通伤害");
  }
}

// ---------- 13. 吸血斩：造成伤害并回复等量 50% 的生命 ----------
skill life_drain {
  let dmg = stat(caster, "atk") * 1.1 - stat(target, "def") * 0.4;
  let dealt = damage(caster, target, dmg, "shadow");
  heal(caster, caster, dealt * 0.5);
}

// ---------- 14. 瞬影突袭：闪避判定完全写在脚本里（try_damage 走种子随机） ----------
skill elusive_strike {
  let base = stat(caster, "atk") * 1.05 - stat(target, "def") * 0.4;
  let result = try_damage(caster, target, base, "phys", stat(caster, "critRate"), stat(caster, "critDmg"), stat(target, "dodge"));
  let hit = result[0];
  if (hit == 1) {
    log("瞬影突袭命中，造成 " + result[2] + " 点伤害");
  } else {
    log("瞬影突袭被闪避", "dodge");
  }
}

// ---------- 14b. 以牙还牙（被动）：受击后用脚本判定闪避风格的反击 ----------
skill riposte {
  on "take_hit" {
    if (chance(1)) {
      damage(target, attacker, stat(target, "atk") * 0.8, "phys");
      log("以牙还牙反击", "trigger");
    }
  }
}

// ---------- 15. 横扫：主目标全额，其余敌方每人受到 50% 溅射 ----------
skill sweep {
  let main = stat(caster, "atk") * 1.0 - stat(target, "def") * 0.5;
  damage(caster, target, main, "phys");
  let enemies = enemies_of(caster);
  let i = 0;
  while (i < len(enemies)) {
    let other = enemies[i];
    if (other != target) {
      damage(caster, other, main * 0.5, "phys");
    }
    i = i + 1;
  }
}

// ---------- 16. 净化打击：伤害并驱散目标一个增益 ----------
skill purifying_strike {
  damage(caster, target, stat(caster, "atk") - stat(target, "def") * 0.5, "phys");
  if (has_buff(target, "shield")) {
    remove_buff(target, "shield");
    log("净化打击驱散了护盾", "info");
  }
}

// ---------- 17. 虚弱诅咒：降低目标 30% 攻击力，持续 3 回合 ----------
skill weaken_curse {
  add_buff(target, "weakness", caster);
}
buff weakness {
  set_stacking("refresh");
  set_duration(3);
  mod_stat("atk", -30, "percent");
}

// ---------- 18. 亡语祝福（被动）：单位死亡时为存活的全体队友回复 50 ----------
skill last_blessing {
  on "death" {
    let allies = allies_of(unit);
    let i = 0;
    while (i < len(allies)) {
      if (is_alive(allies[i])) {
        heal(unit, allies[i], 50);
      }
      i = i + 1;
    }
    log("亡语祝福为全队回复生命", "heal");
  }
}

// ---------- 19. 连环闪电：命中后显式触发 on_hit 连锁（内置深度保护） ----------
skill chain_lightning {
  let dmg = stat(caster, "atk") * 0.9 - stat(target, "def") * 0.3;
  let dealt = damage(caster, target, dmg, "none");
  fire_event("hit", caster, target, dealt, "none");
  on "hit" {
    let next = stat(attacker, "atk") * 0.4;
    damage(attacker, target, next, "none");
    log("连锁闪电追加伤害", "damage");
  }
}

// ---------- 20. 法力燃烧：按目标当前法力造成额外伤害并清空法力 ----------
skill mana_burn {
  let extra = target.mp * 1.5;
  let dmg = stat(caster, "atk") * 0.7 + extra;
  damage(caster, target, dmg, "none");
  add_mp(target, -target.mp);
  log("法力燃烧清空目标法力", "info");
}
