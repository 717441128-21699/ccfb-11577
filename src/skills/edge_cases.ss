// 专用异常演示脚本：
// 1. infinite_loop：while 死循环，触发引擎迭代上限
// 2. echo_buff：受击再给自己挂同名 buff 并再次受击，制造触发器连锁，触发深度上限

skill infinite_loop {
  let i = 0;
  while (1 == 1) {
    i = i + 1;
  }
  damage(caster, target, 10, "phys");
}

skill chain_reaction {
  on "take_hit" {
    add_buff(target, "echo", target);
    damage(attacker, target, 1, "phys");
  }
}

buff echo {
  set_stacking("separate");
  set_duration(1);
  on "take_hit" {
    damage(attacker, target, 1, "phys");
  }
}
