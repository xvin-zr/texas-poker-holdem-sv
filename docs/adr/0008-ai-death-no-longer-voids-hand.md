# AI 弃牌致死不再作废本手

## 背景

ADR-0005 将四条手结束路径统一收敛到 `hand-resolved` 暂停，其中「弃牌致死本手作废」通过 `HandResolution` 的 `void` 判别器实现。ADR-0007 又在这条路径上增加了人类死亡的短路：人类在弃牌开枪中死亡时直接进入 `human-dead`，`void` 仅用于向死亡弹窗透传死因。

实际体验发现：AI 在弃牌开枪（非 All-in 的 `fold-shoot-expired`）或 All-in 结算弃牌开枪（`all-in-settlement-fold-shoot-expired`，t=2.5）中死亡时，若仍有 ≥2 名存活玩家，引擎会把本手作废并进入 `hand-resolved` 暂停。一次 AI 死亡就会打断整手——包括其他玩家已经投入的水位与下注轮——节奏被非人类死亡过度干扰。

## 决定

撤销 AI 死亡的 `void` 作废路径：

1. **`applyFoldShoot`（非 All-in 弃牌开枪）**：人类致死仍转 `human-dead`（保留 `void` 透传死因，ADR-0007 不变）；存活或 AI 致死统一走「从弃牌者位置继续」路径——标记 `alive: !died` 后依次判 `resolveIfOnlyOneActive`（→ `fold-win`）、`winIfOnlyOneAlive`（→ `won`）、否则 `advance` 推进行动轮。AI 死亡不再产生 `void`，也不再进 `hand-resolved`。
2. **`shootAllInFolders`（All-in 结算 t=2.5 弃牌开枪）**：人类致死仍转 `human-dead`；AI 弃牌开枪死亡不再返回 `void`/`hand-resolved`，仅 `winIfOnlyOneAlive`（→ `won`）判一次，否则 `return next` 让结算时间轴继续推进到 reveal→t=6 比牌。死亡的弃牌者 `folded=true`+`alive=false`，被 `buildAllInShowdown`（`alive && !folded`）自然跳过，不影响比牌。
3. **`applyShowdownShoot` 与 `shootAllInLosers`** 行为完全不变：摊牌/比牌已经结束，死亡只是顺带记录，仍走 `hand-resolved`/`won`。
4. `HandResolution` 的 `void` 判别器继续为人类死亡路径服务，作为死因透传载体；AI 路径不再产生 `void`。

复用现有 `resolveIfOnlyOneActive` / `winIfOnlyOneAlive` / `advance` / `activePlayers`，不新增判定函数、不新增 `GameStatus`、不新增 `GameState` 字段、不新增事件。

## 后果

- AI 死亡不再引入暂停，本手节奏不被打断；死者通过座位 `opacity-50` +「出局」徽章 + 弃牌开枪结果徽章 `lastShootLabel` 揭示。
- `lastShootLabel` 的「·本手作废」后缀判定从 `game.status === 'hand-resolved'` 改为 `game.handResolution?.kind === 'void'`：AI 死亡不再进 `hand-resolved`，人类死亡进 `human-dead` 时 `handResolution.kind === 'void'` 仍为真，该后缀仅对人类死亡弹窗有意义。
- `void` 的语义收窄：从「弃牌致死本手作废」退化为「人类死亡死因载体」。未来读者看到 `void` 时能明确知道它只与人类死亡相关。
- `CONTEXT.md`「本手结算」「弃牌」术语同步更新，避免与旧语义混淆。

## 考虑过的替代

- **保留 AI 死亡作废路径**：节奏会被单次 AI 死亡打断，与「AI 死亡只是本手中的普通事件」的玩家预期不符。否决。
- **新增一个「ai-dead」中间状态做死亡揭示**：增加状态机复杂度；现有 badge 揭示已足够传达信息。否决。
- **把 AI 死亡也进 `hand-resolved` 但非 `void`**：仍然暂停本手，没有解决节奏问题。否决。
