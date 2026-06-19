<svelte:options runes={true} />

<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import {
    engine,
    initialState,
    randomThinkDelayMs,
    weightedAiDecision,
    type Card as PlayingCard,
    type Decision,
    type GameState,
    type PlayerId,
  } from '$lib/engine';

  let game: GameState = $state(initialState);
  const currentActor = $derived(game.players.find((player) => player.id === game.currentActorId));
  const currentActorName = $derived(currentActor?.name ?? '无');
  const currentStageName = $derived(game.stage ? stageText(game.stage) : '未开始');
  const thinkingPlayerId = $derived(
    game.status === 'playing' && currentActor && !currentActor.isHuman ? currentActor.id : null,
  );
  const thinkingPlayerName = $derived(
    game.players.find((player) => player.id === thinkingPlayerId)?.name ?? '',
  );

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

  function startGame() {
    game = engine(game, { type: 'start-game' }).state;
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
    {:else}
      <div class="flex flex-wrap gap-2">
        <Badge>当前阶段：{currentStageName}</Badge>
        <Badge variant="secondary">当前行动者：{currentActorName}</Badge>
        {#if thinkingPlayerName}<Badge variant="outline">{thinkingPlayerName} 正在思考…</Badge>{/if}
      </div>

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
          <Card data-testid="seat">
            <CardHeader class="gap-3">
              <CardTitle>{player.name}</CardTitle>
              <div class="flex flex-wrap gap-2">
                <Badge variant={player.isHuman ? 'default' : 'secondary'}>
                  身份：{player.isHuman ? '人类' : 'AI'}
                </Badge>
                <Badge variant={player.alive ? 'outline' : 'destructive'}
                  >{player.alive ? '存活' : '死亡'}</Badge
                >
                {#if player.folded}<Badge variant="destructive">弃牌</Badge>{/if}
                {#if player.allIn}<Badge>全押</Badge>{/if}
                {#if player.id === game.currentActorId}<Badge>行动中</Badge>{/if}
              </div>
            </CardHeader>
            <CardContent class="space-y-3">
              <p>本手下注：{player.betThisHand} 颗子弹</p>
              <div class="flex gap-2" aria-label={`${player.name}底牌`}>
                {#if player.isHuman}
                  {#each player.holeCards as card (card.rank + card.suit)}
                    <span
                      class="bg-background rounded-lg border px-3 py-2 font-mono"
                      data-testid="human-hole-card"
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
