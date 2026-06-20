<svelte:options runes={true} />

<script lang="ts">
  import AlertDialogAction from '$lib/components/ui/alert-dialog/alert-dialog-action.svelte';
  import AlertDialogCancel from '$lib/components/ui/alert-dialog/alert-dialog-cancel.svelte';
  import AlertDialogContent from '$lib/components/ui/alert-dialog/alert-dialog-content.svelte';
  import AlertDialogDescription from '$lib/components/ui/alert-dialog/alert-dialog-description.svelte';
  import AlertDialogFooter from '$lib/components/ui/alert-dialog/alert-dialog-footer.svelte';
  import AlertDialogHeader from '$lib/components/ui/alert-dialog/alert-dialog-header.svelte';
  import AlertDialogTitle from '$lib/components/ui/alert-dialog/alert-dialog-title.svelte';
  import AlertDialog from '$lib/components/ui/alert-dialog/alert-dialog.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import Spinner from '$lib/components/ui/spinner/spinner.svelte';
  import {
    ALL_IN_HUMAN_TIMEOUT_MS,
    ALL_IN_SETTLEMENT_CHOICE_DELAY_MS,
    ALL_IN_SETTLEMENT_FOLD_SHOOT_DELAY_MS,
    ALL_IN_SETTLEMENT_REVEAL_DELAY_MS,
    ALL_IN_SETTLEMENT_SHOWDOWN_DELAY_MS,
    decideForAi,
    defaultDeck,
    engine,
    FOLD_SHOOT_DELAY_MS,
    SHOWDOWN_SHOOT_DELAY_MS,
    initialState,
    shuffleDeck,
    type Card as PlayingCard,
    type Decision,
    type GameState,
    type PlayerId,
    type ShootResult,
  } from '$lib/engine';
  import * as Match from 'effect/Match';
  import * as Result from 'effect/Result';
  import { onDestroy } from 'svelte';

  import { createOpenRouterAiDecider } from './ai-decider';

  let game: GameState = $state(initialState);
  // 最近一次弃牌开枪结果，用于展示揭示过渡（存活退出标记 / 致死作废过渡）。
  let lastShoot = $state<{ playerId: PlayerId; died: boolean } | null>(null);
  // 最近一次摊牌输者开枪结果，跨入下一手 / 胜利屏后仍展示一次。
  let lastShowdownShoot = $state<{ loserIds: PlayerId[]; diedIds: PlayerId[] } | null>(null);
  let lastAllInFoldShoot = $state<ShootResult[] | null>(null);
  let lastAllInShoot = $state<{ loserIds: PlayerId[]; diedIds: PlayerId[] } | null>(null);
  let allInHumanRemaining = $state(ALL_IN_HUMAN_TIMEOUT_MS / 1000);
  let activeHumanAllInTimerId: string | null = null;
  let humanAllInTimeout: ReturnType<typeof setTimeout> | null = null;
  let humanAllInInterval: ReturnType<typeof setInterval> | null = null;
  let activeAllInAiTimerId: string | null = null;
  let allInAiTimeouts: { timeout: ReturnType<typeof setTimeout>; cancel: () => void }[] = [];
  let activeAllInSettlementTimerKey: string | null = null;
  let allInSettlementTimeout: ReturnType<typeof setTimeout> | null = null;

  const currentActor = $derived(game.players.find((player) => player.id === game.currentActorId));
  const currentActorName = $derived(currentActor?.name ?? '无');
  const currentStageName = $derived(game.stage ? stageText(game.stage) : '未开始');
  const thinkingPlayerId = $derived(
    game.status === 'playing' && !game.allInWait && currentActor && !currentActor.isHuman
      ? currentActor.id
      : null,
  );
  const thinkingPlayerName = $derived(
    game.players.find((player) => player.id === thinkingPlayerId)?.name ?? '',
  );
  // 弃牌开枪阻塞期间展示的玩家（外置 2.5s 定时器由 UI 层持有）。
  const pendingShootPlayer = $derived(
    game.pendingFoldShoot
      ? (game.players.find((player) => player.id === game.pendingFoldShoot) ?? null)
      : null,
  );
  const winner = $derived(
    game.status === 'won' && game.winnerId
      ? (game.players.find((player) => player.id === game.winnerId) ?? null)
      : null,
  );
  const allInWait = $derived(game.allInWait);
  const allInSettlement = $derived(game.allInSettlement);
  const canHumanAct = $derived(
    game.status === 'playing' && !allInWait && game.currentActorId === 'human',
  );
  const canHumanAllIn = $derived(canHumanAct && game.stage !== 'river');
  const humanAllInPending = $derived(isAllInResponderPending('human'));
  const humanPlayer = $derived(game.players.find((player) => player.isHuman));
  // 死亡弹窗用：死亡快照中已撞牌的他人（存活未弃牌 AI 在撞牌/全押亮牌时翻开）。
  const revealedOthers = $derived(
    game.players.filter((player) => !player.isHuman && shouldRevealHoleCards(player)),
  );
  const lastShootLabel = $derived.by(() => {
    const shoot = lastShoot;
    if (!shoot) return null;
    const name = game.players.find((player) => player.id === shoot.playerId)?.name ?? '';
    const outcome = shoot.died ? '死亡' : '存活';
    const suffix = shoot.died && game.handResolution?.kind === 'void' ? '·本手作废' : '';
    return { text: `${name}开枪：${outcome}${suffix}`, died: shoot.died };
  });
  const lastShowdownLabel = $derived.by(() => {
    const shoot = lastShowdownShoot;
    if (!shoot) return null;
    if (shoot.loserIds.length === 0) return '全员平局，无人开枪';
    const text = shoot.loserIds
      .map((id) => `${playerName(id)}${shoot.diedIds.includes(id) ? '死亡' : '存活'}`)
      .join('、');
    return `输者开枪：${text}`;
  });
  const lastAllInFoldShootLabel = $derived.by(() => {
    const results = lastAllInFoldShoot;
    if (!results || results.length === 0) return null;
    return `全押弃牌开枪：${results
      .map((result) => `${playerName(result.playerId)}${result.died ? '死亡' : '存活'}`)
      .join('、')}`;
  });
  const lastAllInShootLabel = $derived.by(() => {
    const shoot = lastAllInShoot;
    if (!shoot) return null;
    if (shoot.loserIds.length === 0) return '全押比牌无人开枪';
    const text = shoot.loserIds
      .map((id) => `${playerName(id)}${shoot.diedIds.includes(id) ? '死亡' : '存活'}`)
      .join('、');
    return `全押输者开枪：${text}`;
  });

  $effect(() => {
    if (!thinkingPlayerId || !currentActor || currentActor.isHuman) return;
    const actorId = currentActor.id;
    const personality = currentActor.personality ?? 'balanced';
    const decider = createOpenRouterAiDecider(personality);
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const decision = await decideForAi(decider, game, actorId);
      if (!cancelled && Result.isSuccess(decision)) {
        game = engine(game, {
          type: 'ai-think-expired',
          playerId: actorId,
          decision: decision.success,
        }).state;
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  });

  // All-in 等待里的 AI 并行计时；每个待响应 AI 从同一等待开始点独立思考。
  $effect(() => {
    const wait = game.allInWait;
    if (!wait) {
      clearAllInAiTimers();
      activeAllInAiTimerId = null;
      return;
    }
    if (activeAllInAiTimerId === wait.timerId) return;
    clearAllInAiTimers();
    activeAllInAiTimerId = wait.timerId;
    allInAiTimeouts = wait.responderIds
      .filter((playerId) => !game.players.find((player) => player.id === playerId)?.isHuman)
      .map((playerId) => {
        const player = game.players.find((candidate) => candidate.id === playerId);
        const personality = player?.personality ?? 'balanced';
        const decider = createOpenRouterAiDecider(personality);
        let cancelled = false;
        const timeout = setTimeout(async () => {
          const decision = await decideForAi(decider, game, playerId);
          if (!cancelled && Result.isSuccess(decision)) {
            game = engine(game, {
              type: 'ai-think-expired',
              playerId,
              decision: decision.success,
            }).state;
          }
        }, 0);
        return {
          timeout,
          cancel: () => {
            cancelled = true;
          },
        };
      });
  });

  // All-in 等待的人类 10s 硬超时；AI 不走这个超时。
  $effect(() => {
    const wait = game.allInWait;
    const pending = isAllInResponderPending('human');
    if (!wait || !pending) {
      clearHumanAllInTimer();
      activeHumanAllInTimerId = null;
      allInHumanRemaining = ALL_IN_HUMAN_TIMEOUT_MS / 1000;
      return;
    }
    if (activeHumanAllInTimerId === wait.timerId) return;
    clearHumanAllInTimer();
    activeHumanAllInTimerId = wait.timerId;
    const startedAt = Date.now();
    allInHumanRemaining = ALL_IN_HUMAN_TIMEOUT_MS / 1000;
    humanAllInInterval = setInterval(() => {
      const remaining = ALL_IN_HUMAN_TIMEOUT_MS - (Date.now() - startedAt);
      allInHumanRemaining = Math.max(0, Math.ceil(remaining / 1000));
    }, 250);
    humanAllInTimeout = setTimeout(() => {
      game = engine(game, { type: 'all-in-timeout', playerId: 'human' }).state;
      clearHumanAllInTimer();
    }, ALL_IN_HUMAN_TIMEOUT_MS);
  });

  // 弃牌开枪定时器外置：pendingFoldShoot 置位后 2.5s 回灌到期事件，roll 由 UI 注入。
  $effect(() => {
    const pending = game.pendingFoldShoot;
    if (!pending) return;
    const timeout = setTimeout(() => {
      const roll = Math.random();
      const before = game.players.find((player) => player.id === pending)?.alive ?? false;
      const next = engine(game, {
        type: 'fold-shoot-expired',
        playerId: pending,
        roll,
      }).state;
      const after = next.players.find((player) => player.id === pending)?.alive ?? false;
      game = next;
      lastShoot = { playerId: pending, died: before && !after };
    }, FOLD_SHOOT_DELAY_MS);
    return () => clearTimeout(timeout);
  });

  // 摊牌输者同时开枪：一次事件带入所有输者 roll，避免逐个结算影响胜利判定。
  $effect(() => {
    const showdown = game.showdown;
    if (game.status !== 'showdown' || !showdown) return;
    const settleShowdown = () => {
      const rolls = Object.fromEntries(showdown.loserIds.map((id) => [id, Math.random()]));
      const beforeAlive = new Set(
        game.players.filter((player) => player.alive).map((player) => player.id),
      );
      const next = engine(game, {
        type: 'showdown-shoot-expired',
        rolls,
      }).state;
      const diedIds = showdown.loserIds.filter(
        (id) => beforeAlive.has(id) && !next.players.find((player) => player.id === id)?.alive,
      );
      game = next;
      lastShowdownShoot = { loserIds: showdown.loserIds, diedIds };
    };
    if (showdown.loserIds.length === 0) {
      settleShowdown();
      return;
    }
    const timeout = setTimeout(settleShowdown, SHOWDOWN_SHOOT_DELAY_MS);
    return () => clearTimeout(timeout);
  });

  // All-in 结算时间轴定时器外置：UI 按 t=0/2.5/3.5/6 回灌事件。
  $effect(() => {
    const settlement = game.allInSettlement;
    if (game.status !== 'all-in-settle' || !settlement) {
      clearAllInSettlementTimer();
      activeAllInSettlementTimerKey = null;
      if (game.status === 'playing') {
        lastAllInFoldShoot = null;
        lastAllInShoot = null;
      }
      return;
    }
    const timerKey = `${settlement.timerId}:${settlement.step}`;
    if (activeAllInSettlementTimerKey === timerKey) return;
    clearAllInSettlementTimer();
    activeAllInSettlementTimerKey = timerKey;

    Match.value(settlement.step).pipe(
      Match.when('pending', () => {
        lastAllInFoldShoot = null;
        lastAllInShoot = null;
        allInSettlementTimeout = setTimeout(() => {
          game = engine(game, { type: 'all-in-settlement-choices-expired' }).state;
        }, ALL_IN_SETTLEMENT_CHOICE_DELAY_MS);
      }),
      Match.when('choices', () => {
        allInSettlementTimeout = setTimeout(() => {
          const rolls = Object.fromEntries(
            settlement.foldedPlayerIds.map((id) => [id, Math.random()]),
          );
          const beforeAlive = new Set(
            game.players.filter((player) => player.alive).map((player) => player.id),
          );
          const next = engine(game, {
            type: 'all-in-settlement-fold-shoot-expired',
            rolls,
          }).state;
          lastAllInFoldShoot = settlement.foldedPlayerIds.map((id) => ({
            playerId: id,
            died: beforeAlive.has(id) && !next.players.find((player) => player.id === id)?.alive,
          }));
          game = next;
        }, ALL_IN_SETTLEMENT_FOLD_SHOOT_DELAY_MS);
      }),
      Match.when('fold-shoot', () => {
        allInSettlementTimeout = setTimeout(() => {
          game = engine(game, { type: 'all-in-settlement-reveal-expired' }).state;
        }, ALL_IN_SETTLEMENT_REVEAL_DELAY_MS);
      }),
      Match.when('reveal', () => {
        allInSettlementTimeout = setTimeout(() => {
          const loserIds = settlement.showdown?.loserIds ?? [];
          const rolls = Object.fromEntries(loserIds.map((id) => [id, Math.random()]));
          const beforeAlive = new Set(
            game.players.filter((player) => player.alive).map((player) => player.id),
          );
          const next = engine(game, {
            type: 'all-in-settlement-showdown-expired',
            rolls,
          }).state;
          const diedIds = loserIds.filter(
            (id) => beforeAlive.has(id) && !next.players.find((player) => player.id === id)?.alive,
          );
          game = next;
          lastAllInShoot = { loserIds, diedIds };
        }, ALL_IN_SETTLEMENT_SHOWDOWN_DELAY_MS);
      }),
      Match.exhaustive,
    );
  });

  onDestroy(() => {
    clearHumanAllInTimer();
    clearAllInAiTimers();
    clearAllInSettlementTimer();
  });

  function startGame() {
    clearHumanAllInTimer();
    clearAllInAiTimers();
    clearAllInSettlementTimer();
    activeHumanAllInTimerId = null;
    activeAllInAiTimerId = null;
    activeAllInSettlementTimerKey = null;
    game = engine(game, { type: 'start-game', deck: shuffleDeck(defaultDeck) }).state;
    lastShoot = null;
    lastShowdownShoot = null;
    lastAllInFoldShoot = null;
    lastAllInShoot = null;
  }

  function startNextHand() {
    if (game.status !== 'hand-resolved') return;
    // 进入下一手时清除上一手结算揭示标记。
    lastShoot = null;
    lastShowdownShoot = null;
    lastAllInFoldShoot = null;
    lastAllInShoot = null;
    game = engine(game, { type: 'next-hand', deck: shuffleDeck(defaultDeck) }).state;
  }

  function act(decision: Decision) {
    if (!canHumanAct) return;
    game = engine(game, { type: 'player-action', playerId: 'human', decision }).state;
  }

  function respondAllInWait(decision: Decision) {
    if (!humanAllInPending || decision.action === 'call') return;
    game = engine(game, { type: 'player-action', playerId: 'human', decision }).state;
  }

  function clearHumanAllInTimer() {
    if (humanAllInTimeout) clearTimeout(humanAllInTimeout);
    if (humanAllInInterval) clearInterval(humanAllInInterval);
    humanAllInTimeout = null;
    humanAllInInterval = null;
  }

  function clearAllInAiTimers() {
    for (const { timeout, cancel } of allInAiTimeouts) {
      cancel();
      clearTimeout(timeout);
    }
    allInAiTimeouts = [];
  }

  function clearAllInSettlementTimer() {
    if (allInSettlementTimeout) clearTimeout(allInSettlementTimeout);
    allInSettlementTimeout = null;
  }

  function isAllInResponderPending(playerId: PlayerId) {
    const wait = game.allInWait;
    return Boolean(wait?.responderIds.includes(playerId) && !wait.respondedIds.includes(playerId));
  }

  function allInResponderStatusText(playerId: PlayerId) {
    const wait = game.allInWait;
    if (!wait) return '';
    if (wait.timedOutIds.includes(playerId)) return '超时弃牌';
    if (!wait.respondedIds.includes(playerId)) return '等待响应';
    const player = game.players.find((candidate) => candidate.id === playerId);
    return player?.allIn ? '已全押' : '已弃牌';
  }

  function allInSettlementPlayerIds(settlement: NonNullable<GameState['allInSettlement']>) {
    return [settlement.triggerPlayerId, ...settlement.responderIds];
  }

  function allInSettlementText(playerId: PlayerId) {
    const settlement = game.allInSettlement;
    if (!settlement) return '';
    if (settlement.timedOutIds.includes(playerId)) return '超时弃牌';
    if (settlement.allInPlayerIds.includes(playerId)) return '全押';
    if (settlement.foldedPlayerIds.includes(playerId)) return '弃牌';
    return '未响应';
  }

  function allInSettlementStepText(step: NonNullable<GameState['allInSettlement']>['step']) {
    return {
      pending: '准备展示选择',
      choices: 't=0 展示选择',
      'fold-shoot': 't=2.5 弃牌开枪完成',
      reveal: 't=3.5 全押亮牌 / t=6 即将比牌开枪',
    }[step];
  }

  function cardText(card: PlayingCard) {
    return `${card.rank}${card.suit}`;
  }

  function actionText(decision: Decision) {
    return decision.action === 'call' ? '跟注' : decision.action === 'fold' ? '弃牌' : '全押';
  }

  function stageText(stage: NonNullable<GameState['stage']>) {
    return { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' }[stage];
  }

  function handText(category: string) {
    return (
      (
        {
          'high-card': '高牌',
          'one-pair': '一对',
          'two-pair': '两对',
          'three-kind': '三条',
          straight: '顺子',
          flush: '同花',
          'full-house': '葫芦',
          'four-kind': '四条',
          'straight-flush': '同花顺',
        } as Record<string, string>
      )[category] ?? category
    );
  }

  function showdownResultText(result: 'winner' | 'loser' | 'tie') {
    return result === 'winner' ? '赢家' : result === 'loser' ? '输者' : '平局';
  }

  function shouldRevealHoleCards(player: GameState['players'][number]) {
    if (player.isHuman) return true;
    if (player.folded) return false;
    if (allInSettlement?.step === 'reveal' && allInSettlement.allInPlayerIds.includes(player.id))
      return true;
    if (game.showdown?.entries.some((entry) => entry.playerId === player.id)) return true;
    return Boolean(
      allInSettlement?.showdown?.entries.some((entry) => entry.playerId === player.id),
    );
  }

  function isAiThinking(player: GameState['players'][number]) {
    if (player.id === thinkingPlayerId) return true;
    return Boolean(game.allInWait && isAllInResponderPending(player.id) && !player.isHuman);
  }

  function playerName(playerId: PlayerId) {
    return game.players.find((player) => player.id === playerId)?.name ?? playerId;
  }
</script>

<svelte:head><title>德州扑克俄轮版</title></svelte:head>

<main class="bg-muted/40 text-foreground min-h-screen p-6">
  <section class="mx-auto flex max-w-5xl flex-col gap-6">
    <div class="space-y-2">
      <p class="text-muted-foreground text-sm">德扑与俄式轮盘的桌面游戏（仅供娱乐，du 🐶 biss）</p>
      <h1 class="text-3xl font-semibold tracking-tight">德州扑克俄轮版</h1>
    </div>

    {#if game.status === 'idle'}
      <Card class="max-w-xl">
        <CardHeader>
          <CardTitle>准备开局</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <p class="text-muted-foreground">
            点击后进入第一手翻牌前阶段，所有存活玩家自动支付 Ante。
          </p>
          <Button size="lg" onclick={startGame}>开始游戏</Button>
        </CardContent>
      </Card>
    {:else if game.status === 'won'}
      <Card class="max-w-xl" data-testid="win-screen">
        <CardHeader><CardTitle>胜利</CardTitle></CardHeader>
        <CardContent class="space-y-4">
          <p class="text-muted-foreground">
            {winner?.name ?? '无人'} 是最后一名存活玩家。
          </p>
          {#if lastShowdownLabel}
            <Badge variant="destructive" data-testid="showdown-shoot-result">
              {lastShowdownLabel}
            </Badge>
          {/if}
          {#if lastAllInFoldShootLabel}
            <Badge variant="destructive" data-testid="all-in-fold-shoot-result">
              {lastAllInFoldShootLabel}
            </Badge>
          {/if}
          {#if lastAllInShootLabel}
            <Badge variant="destructive" data-testid="all-in-shoot-result">
              {lastAllInShootLabel}
            </Badge>
          {/if}
          <Button size="lg" onclick={startGame}>开始</Button>
        </CardContent>
      </Card>
    {:else}
      {#if game.status === 'human-dead'}
        <AlertDialog open={true}>
          <AlertDialogContent data-testid="human-dead-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>你已死亡</AlertDialogTitle>
              <AlertDialogDescription>本局已结束</AlertDialogDescription>
              {#if lastAllInShootLabel}
                <Badge variant="destructive" data-testid="all-in-shoot-result">
                  {lastAllInShootLabel}
                </Badge>
              {:else if lastAllInFoldShootLabel}
                <Badge variant="destructive" data-testid="all-in-fold-shoot-result">
                  {lastAllInFoldShootLabel}
                </Badge>
              {:else if lastShowdownLabel}
                <Badge variant="destructive" data-testid="showdown-shoot-result">
                  {lastShowdownLabel}
                </Badge>
              {:else if lastShootLabel}
                <Badge variant="destructive" data-testid="human-dead-shoot-result">
                  {lastShootLabel.text}
                </Badge>
              {/if}
              <div class="space-y-3 pt-2">
                <div>
                  <p class="text-sm font-medium">公共牌</p>
                  <div class="flex flex-wrap gap-2 pt-1">
                    {#if game.communityCards.length === 0}
                      <p class="text-muted-foreground text-sm">尚无公共牌</p>
                    {:else}
                      {#each game.communityCards as card (card.rank + card.suit)}
                        <span
                          class="bg-background rounded-lg border px-3 py-2 font-mono"
                          data-testid="dead-community-card"
                        >
                          {cardText(card)}
                        </span>
                      {/each}
                    {/if}
                  </div>
                </div>
                <div>
                  <p class="text-sm font-medium">你的底牌</p>
                  <div class="flex gap-2 pt-1">
                    {#each humanPlayer?.holeCards ?? [] as card (card.rank + card.suit)}
                      <span
                        class="bg-background rounded-lg border px-3 py-2 font-mono"
                        data-testid="dead-human-hole-card"
                      >
                        {cardText(card)}
                      </span>
                    {/each}
                  </div>
                </div>
                {#if revealedOthers.length > 0}
                  <div>
                    <p class="text-sm font-medium">已撞牌玩家底牌</p>
                    <div class="space-y-2 pt-1">
                      {#each revealedOthers as player (player.id)}
                        <div class="flex items-center gap-2">
                          <span class="text-sm">{player.name}</span>
                          {#each player.holeCards as card (card.rank + card.suit)}
                            <span
                              class="bg-background rounded-lg border px-3 py-2 font-mono"
                              data-testid="dead-revealed-hole-card"
                            >
                              {cardText(card)}
                            </span>
                          {/each}
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button onclick={startGame}>下一局</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      {/if}
      <div class="flex flex-wrap gap-2">
        <Badge>当前阶段：{currentStageName}</Badge>
        <Badge variant="secondary">当前行动者：{currentActorName}</Badge>
        {#if thinkingPlayerName}<Badge variant="outline">{thinkingPlayerName} 正在思考…</Badge>{/if}
        {#if allInWait}
          <Badge variant="destructive" data-testid="all-in-wait-badge">
            全押等待：{playerName(allInWait.triggerPlayerId)} 已全押
          </Badge>
        {/if}
        {#if game.status === 'all-in-settle'}
          <Badge variant="destructive" data-testid="all-in-settle-badge">全押结算</Badge>
        {/if}
        {#if pendingShootPlayer}
          <Badge variant="destructive" data-testid="fold-shoot-pending"
            >{pendingShootPlayer.name} 弃牌，2.5s 后开枪…</Badge
          >
        {/if}
        {#if lastShootLabel}
          <Badge
            variant={lastShootLabel.died ? 'destructive' : 'outline'}
            data-testid="fold-shoot-result"
          >
            {lastShootLabel.text}
          </Badge>
        {/if}
        {#if lastShowdownLabel}
          <Badge variant="destructive" data-testid="showdown-shoot-result">
            {lastShowdownLabel}
          </Badge>
        {/if}
        {#if lastAllInFoldShootLabel}
          <Badge variant="destructive" data-testid="all-in-fold-shoot-result">
            {lastAllInFoldShootLabel}
          </Badge>
        {/if}
        {#if lastAllInShootLabel}
          <Badge variant="destructive" data-testid="all-in-shoot-result">
            {lastAllInShootLabel}
          </Badge>
        {/if}
      </div>

      {#if game.status === 'hand-resolved'}
        <Card data-testid="hand-resolved-panel">
          <CardHeader><CardTitle>本手结算</CardTitle></CardHeader>
          <CardContent class="space-y-3">
            {#if game.handResolution?.kind === 'void'}
              <Badge variant="destructive" data-testid="hand-resolution-void">
                {playerName(game.handResolution.voidPlayerId)} 死亡，本手作废
              </Badge>
            {:else if game.handResolution?.kind === 'fold-win'}
              <Badge variant="secondary" data-testid="hand-resolution-fold-win">
                其他人全弃牌，{playerName(game.handResolution.handWinnerId)} 本手自动获胜
              </Badge>
            {:else if game.handResolution?.kind === 'all-in'}
              <Badge variant="secondary" data-testid="hand-resolution-all-in">全押结算完成</Badge>
            {:else}
              <Badge variant="secondary" data-testid="hand-resolution-showdown">摊牌结算完成</Badge>
            {/if}
            <div>
              <Button size="lg" data-testid="next-hand-button" onclick={startNextHand}
                >开始下一手</Button
              >
            </div>
          </CardContent>
        </Card>
      {/if}

      {#if allInWait}
        <Card data-testid="all-in-wait-panel">
          <CardHeader><CardTitle>全押等待</CardTitle></CardHeader>
          <CardContent class="space-y-3">
            <p class="text-muted-foreground">
              {playerName(allInWait.triggerPlayerId)} 已全押，本阶段行动轮立即中断。待响应者只能全押或弃牌。
            </p>
            <div class="flex flex-wrap gap-2">
              {#each allInWait.responderIds as responderId (responderId)}
                <Badge variant="outline" data-testid="all-in-responder">
                  {playerName(responderId)}：{allInResponderStatusText(responderId)}
                </Badge>
              {/each}
            </div>
          </CardContent>
        </Card>
      {/if}

      {#if allInWait && humanAllInPending}
        <AlertDialog open={true}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>必须响应全押</AlertDialogTitle>
              <AlertDialogDescription>
                {playerName(allInWait.triggerPlayerId)} 已全押，你只能全押或弃牌。
              </AlertDialogDescription>
              <Badge variant="destructive" data-testid="all-in-countdown">
                人类倒计时：{allInHumanRemaining}s
              </Badge>
              <div class="space-y-3 pt-2">
                <div>
                  <p class="text-sm font-medium">你的底牌</p>
                  <div class="flex gap-2 pt-1">
                    {#each humanPlayer?.holeCards ?? [] as card (card.rank + card.suit)}
                      <span
                        class="bg-background rounded-lg border px-3 py-2 font-mono"
                        data-testid="all-in-human-hole-card"
                      >
                        {cardText(card)}
                      </span>
                    {/each}
                  </div>
                </div>
                <div>
                  <p class="text-sm font-medium">当前公共牌</p>
                  <div class="flex flex-wrap gap-2 pt-1">
                    {#if game.communityCards.length === 0}
                      <p class="text-muted-foreground text-sm">翻牌前尚无公共牌</p>
                    {:else}
                      {#each game.communityCards as card (card.rank + card.suit)}
                        <span
                          class="bg-background rounded-lg border px-3 py-2 font-mono"
                          data-testid="all-in-community-card"
                        >
                          {cardText(card)}
                        </span>
                      {/each}
                    {/if}
                  </div>
                </div>
              </div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction
                data-testid="all-in-response-all-in"
                onclick={() => respondAllInWait({ action: 'all-in' })}>全押</AlertDialogAction
              >
              <AlertDialogCancel
                data-testid="all-in-response-fold"
                onclick={() => respondAllInWait({ action: 'fold' })}>弃牌</AlertDialogCancel
              >
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      {/if}

      {#if (game.status === 'all-in-settle' || game.status === 'hand-resolved' || game.status === 'human-dead') && allInSettlement}
        <Card data-testid="all-in-settle-panel">
          <CardHeader><CardTitle>全押结算时间轴</CardTitle></CardHeader>
          <CardContent class="space-y-3">
            <Badge variant="outline" data-testid="all-in-settle-step">
              {allInSettlementStepText(allInSettlement.step)}
            </Badge>
            {#if allInSettlement.step !== 'pending'}
              <div class="flex flex-wrap gap-2">
                {#each allInSettlementPlayerIds(allInSettlement) as playerId (playerId)}
                  <Badge variant="secondary" data-testid="all-in-settle-choice">
                    {playerName(playerId)}：{allInSettlementText(playerId)}
                  </Badge>
                {/each}
              </div>
            {/if}
            {#if allInSettlement.step === 'choices'}
              <p class="text-muted-foreground">t=2.5 弃牌玩家将同时开枪。</p>
            {:else if allInSettlement.step === 'fold-shoot' || allInSettlement.step === 'reveal'}
              {#if allInSettlement.foldShootResults.length === 0}
                <Badge variant="outline" data-testid="all-in-fold-shoot-empty">
                  无弃牌玩家开枪
                </Badge>
              {:else}
                <div class="flex flex-wrap gap-2">
                  {#each allInSettlement.foldShootResults as result (result.playerId)}
                    <Badge
                      variant={result.died ? 'destructive' : 'outline'}
                      data-testid="all-in-fold-shoot-item"
                    >
                      {playerName(result.playerId)}：{result.died ? '死亡' : '存活'}
                    </Badge>
                  {/each}
                </div>
              {/if}
            {/if}
            {#if allInSettlement.step === 'reveal'}
              <Badge variant="secondary" data-testid="all-in-reveal">
                全押玩家亮牌，公共牌已翻到河牌
              </Badge>
              <p class="text-muted-foreground">t=6 比较全押玩家牌型，输者同时开枪。</p>
            {/if}
          </CardContent>
        </Card>
      {/if}

      {#if (game.status === 'showdown' || game.status === 'hand-resolved' || game.status === 'human-dead') && game.showdown}
        <Card data-testid="showdown-panel">
          <CardHeader><CardTitle>摊牌</CardTitle></CardHeader>
          <CardContent class="space-y-3">
            <p class="text-muted-foreground">所有公共牌已翻到河牌，存活未弃牌玩家亮牌比大小。</p>
            <div class="flex flex-wrap gap-2">
              {#each game.showdown.entries as entry (entry.playerId)}
                <Badge
                  variant={entry.result === 'loser' ? 'destructive' : 'secondary'}
                  data-testid={`showdown-${entry.result}`}
                >
                  {playerName(entry.playerId)}：{handText(entry.hand.category)} · {showdownResultText(
                    entry.result,
                  )}
                </Badge>
              {/each}
            </div>
            {#if game.showdown.loserIds.length === 0}
              <Badge variant="outline" data-testid="showdown-tie">全员平局，无人开枪</Badge>
            {:else if game.status === 'showdown'}
              <Badge variant="destructive">输者 2.5s 后同时开枪…</Badge>
            {/if}
          </CardContent>
        </Card>
      {/if}

      <Card>
        <CardHeader><CardTitle>公共牌</CardTitle></CardHeader>
        <CardContent class="flex flex-wrap gap-2">
          {#if game.communityCards.length === 0}
            <p class="text-muted-foreground">翻牌前尚未翻开公共牌</p>
          {:else}
            {#each game.communityCards as card (card.rank + card.suit)}
              <span
                class="bg-background rounded-lg border px-3 py-2 font-mono"
                data-testid="community-card"
              >
                {cardText(card)}
              </span>
            {/each}
          {/if}
        </CardContent>
      </Card>

      <div class="flex gap-2">
        <Button disabled={!canHumanAct} onclick={() => act({ action: 'call' })}>跟注</Button>
        <Button variant="outline" disabled={!canHumanAct} onclick={() => act({ action: 'fold' })}
          >弃牌</Button
        >
        <Button
          variant="secondary"
          disabled={!canHumanAllIn}
          onclick={() => act({ action: 'all-in' })}>全押</Button
        >
      </div>

      <div class="grid gap-4 md:grid-cols-2" data-testid="seats">
        {#each game.players as player (player.id)}
          <Card data-testid="seat" class={player.alive ? '' : 'opacity-50'}>
            <CardHeader class="gap-3">
              <CardTitle>{player.name}</CardTitle>
              <div class="flex flex-wrap gap-2">
                <Badge variant={player.isHuman ? 'default' : 'secondary'}>
                  身份：{player.isHuman ? '人类' : 'AI'}
                </Badge>
                <Badge variant={player.alive ? 'outline' : 'destructive'}
                  >{player.alive ? '存活' : '出局'}</Badge
                >
                {#if player.folded}<Badge variant="destructive" data-testid="folded-badge"
                    >弃牌</Badge
                  >{/if}
                {#if player.allIn}<Badge>全押</Badge>{/if}
                {#if isAllInResponderPending(player.id)}<Badge variant="outline">待响应</Badge>{/if}
                {#if player.id === game.currentActorId}<Badge>行动中</Badge>{/if}
                {#if isAiThinking(player)}<Spinner
                    class="size-4"
                    data-testid="thinking-spinner"
                  />{/if}
              </div>
            </CardHeader>
            <CardContent class="space-y-3">
              <p>本手下注：{player.betThisHand} 颗子弹</p>
              <div class="flex gap-2" aria-label={`${player.name}底牌`}>
                {#if shouldRevealHoleCards(player)}
                  {#each player.holeCards as card (card.rank + card.suit)}
                    <span
                      class="bg-background rounded-lg border px-3 py-2 font-mono"
                      data-testid={player.isHuman ? 'human-hole-card' : 'ai-hole-card-revealed'}
                    >
                      {cardText(card)}
                    </span>
                  {/each}
                {:else}
                  {#each player.holeCards as card (card.rank + card.suit)}
                    <span
                      class="bg-muted text-muted-foreground rounded-lg border px-3 py-2"
                      data-testid="ai-hole-card-hidden"
                      aria-label="隐藏底牌"
                    >
                      隐藏
                    </span>
                  {/each}
                {/if}
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>

      <Card>
        <CardHeader><CardTitle>行动历史</CardTitle></CardHeader>
        <CardContent>
          {#if game.actionHistory.length === 0}
            <p class="text-muted-foreground">暂无行动</p>
          {:else}
            <ol class="list-decimal space-y-1 pl-5">
              {#each game.actionHistory as action, index (index)}
                <li>
                  {playerName(action.playerId)} 在 {stageText(action.stage)} 选择 {actionText(
                    action.decision,
                  )}
                </li>
              {/each}
            </ol>
          {/if}
        </CardContent>
      </Card>
    {/if}
  </section>
</main>
