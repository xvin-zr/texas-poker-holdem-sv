<script lang="ts">
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import CardContent from '$lib/components/ui/card/card-content.svelte';
	import CardHeader from '$lib/components/ui/card/card-header.svelte';
	import CardTitle from '$lib/components/ui/card/card-title.svelte';
	import { engine, initialState, type Card as PlayingCard, type GameState } from '$lib/engine';

	let state = $state<GameState>(initialState);
	const currentActorName = $derived(
		state.players.find((player) => player.id === state.currentActorId)?.name ?? '无'
	);

	function startGame() {
		state = engine(state, { type: 'start-game' }).state;
	}

	function cardText(card: PlayingCard) {
		return `${card.rank}${card.suit}`;
	}
</script>

<svelte:head><title>德州扑克俄轮版</title></svelte:head>

<main class="min-h-screen bg-muted/40 p-6 text-foreground">
	<section class="mx-auto flex max-w-5xl flex-col gap-6">
		<div class="space-y-2">
			<p class="text-sm text-muted-foreground">德扑与俄式轮盘的桌面游戏</p>
			<h1 class="text-3xl font-semibold tracking-tight">德州扑克俄轮版</h1>
		</div>

		{#if state.status === 'idle'}
			<Card class="max-w-xl">
				<CardHeader>
					<CardTitle>准备开局</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					<p class="text-muted-foreground">点击后进入第一手 preflop，所有存活玩家自动支付 Ante。</p>
					<Button size="lg" onclick={startGame}>开始游戏</Button>
				</CardContent>
			</Card>
		{:else}
			<div class="flex flex-wrap gap-2">
				<Badge>当前阶段：{state.stage}</Badge>
				<Badge variant="secondary">当前行动者：{currentActorName}</Badge>
			</div>

			<div class="grid gap-4 md:grid-cols-2" data-testid="seats">
				{#each state.players as player (player.id)}
					<Card data-testid="seat">
						<CardHeader class="gap-3">
							<CardTitle>{player.name}</CardTitle>
							<div class="flex flex-wrap gap-2">
								<Badge variant={player.isHuman ? 'default' : 'secondary'}>
									身份：{player.isHuman ? '人类' : 'AI'}
								</Badge>
								<Badge variant={player.alive ? 'outline' : 'destructive'}>{player.alive ? '存活' : '死亡'}</Badge>
								{#if player.folded}<Badge variant="destructive">弃牌</Badge>{/if}
								{#if player.allIn}<Badge>全押</Badge>{/if}
								{#if player.id === state.currentActorId}<Badge>行动中</Badge>{/if}
							</div>
						</CardHeader>
						<CardContent class="space-y-3">
							<p>本手下注：{player.betThisHand} 颗子弹</p>
							<div class="flex gap-2" aria-label={`${player.name}底牌`}>
								{#if player.isHuman}
									{#each player.holeCards as card (card.rank + card.suit)}
										<span class="rounded-lg border bg-background px-3 py-2 font-mono" data-testid="human-hole-card">
											{cardText(card)}
										</span>
									{/each}
								{:else}
									{#each player.holeCards as card (card.rank + card.suit)}
										<span class="rounded-lg border bg-muted px-3 py-2 text-muted-foreground" data-testid="ai-hole-card-hidden" aria-label="隐藏底牌">
											隐藏
										</span>
									{/each}
								{/if}
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		{/if}
	</section>
</main>
