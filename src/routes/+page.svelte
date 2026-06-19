<svelte:options runes={true} />

<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import {
    defaultDeck,
    engine,
    FOLD_SHOOT_DELAY_MS,
    SHOWDOWN_SHOOT_DELAY_MS,
    initialState,
    randomThinkDelayMs,
    shuffleDeck,
    weightedAiDecision,
    type Card as PlayingCard,
    type Decision,
    type GameState,
    type PlayerId,
  } from '$lib/engine';

  let game: GameState = $state(initialState);
  // 最近一次弃牌开枪结果，用于展示揭示过渡（存活退出标记 / 致死作废过渡）。
  let lastShoot = $state<{ playerId: PlayerId; died: boolean } | null>(null);
  // 最近一次摊牌输者开枪结果，跨入下一手 / 胜利屏后仍展示一次。
  let lastShowdownShoot = $state<{ loserIds: PlayerId[]; diedIds: PlayerId[] } | null>(null);
  const currentActor = $derived(game.players.find((player) => player.id === game.currentActorId));
  const currentActorName = $derived(currentActor?.name ?? '无');
  const currentStageName = $derived(game.stage ? stageText(game.stage) : '未开始');
  const thinkingPlayerId = $derived(
    game.status === 'playing' && currentActor && !currentActor.isHuman ? currentActor.id : null,
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
  const lastShootLabel = $derived.by(() => {
    const shoot = lastShoot;
    if (!shoot) return null;
    const name = game.players.find((player) => player.id === shoot.playerId)?.name ?? '';
    const outcome = shoot.died ? '死亡' : '存活';
    const suffix = shoot.died && game.status === 'playing' ? '·本手作废' : '';
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

  $effect(() => {
    if (!thinkingPlayerId || !currentActor || currentActor.isHuman) return;
    const actorId = currentActor.id;
    const personality = currentActor.personality ?? 'balanced';
    const stage = game.stage ?? 'preflop';
    const timeout = setTimeout(() => {
      game = engine(game, {
        type: 'ai-think-expired',
        playerId: actorId,
        decision: weightedAiDecision(personality, stage, Math.random, ['call', 'fold']),
      }).state;
    }, randomThinkDelayMs());
    return () => clearTimeout(timeout);
  });

  // 弃牌开枪定时器外置：pendingFoldShoot 置位后 2.5s 回灌到期事件，roll 与洗牌由 UI 注入。
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
        nextDeck: shuffleDeck(defaultDeck),
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
        nextDeck: shuffleDeck(defaultDeck),
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

  function startGame() {
    game = engine(game, { type: 'start-game' }).state;
    lastShoot = null;
    lastShowdownShoot = null;
  }

  function act(decision: Decision) {
    if (game.currentActorId !== 'human') return;
    game = engine(game, { type: 'player-action', playerId: 'human', decision }).state;
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
    return game.status === 'showdown' || !player.alive;
  }

  function playerName(playerId: PlayerId) {
    return game.players.find((player) => player.id === playerId)?.name ?? playerId;
  }
</script>

<svelte:head><title>德州扑克俄轮版</title></svelte:head>

<main class="bg-muted/40 text-foreground min-h-screen p-6">
  <section class="mx-auto flex max-w-5xl flex-col gap-6">
    <div class="space-y-2">
      <p class="text-muted-foreground text-sm">德扑与俄式轮盘的桌面游戏</p>
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
          <Button disabled>重新开始（切片 6）</Button>
        </CardContent>
      </Card>
    {:else}
      <div class="flex flex-wrap gap-2">
        <Badge>当前阶段：{currentStageName}</Badge>
        <Badge variant="secondary">当前行动者：{currentActorName}</Badge>
        {#if thinkingPlayerName}<Badge variant="outline">{thinkingPlayerName} 正在思考…</Badge>{/if}
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
      </div>

      {#if game.status === 'showdown' && game.showdown}
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
            {:else}
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
        <Button disabled={game.currentActorId !== 'human'} onclick={() => act({ action: 'call' })}
          >跟注</Button
        >
        <Button
          variant="outline"
          disabled={game.currentActorId !== 'human'}
          onclick={() => act({ action: 'fold' })}>弃牌</Button
        >
        <Button variant="secondary" disabled>全押</Button>
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
                {#if player.id === game.currentActorId}<Badge>行动中</Badge>{/if}
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
