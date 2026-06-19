import * as Result from 'effect/Result';

export type Stage = 'preflop' | 'flop' | 'turn' | 'river';
export type PlayerId = 'human' | 'ai-1' | 'ai-2' | 'ai-3';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type Suit = '♠' | '♥' | '♦' | '♣';
export type Personality = 'conservative' | 'balanced' | 'aggressive';

export type Card = {
	rank: Rank;
	suit: Suit;
};

export type Decision = { action: 'call' | 'fold' | 'all-in' };
export type EngineError = 'missing-decision-input' | 'invalid-card-count';
export type HandCategory =
	| 'high-card'
	| 'one-pair'
	| 'two-pair'
	| 'three-kind'
	| 'straight'
	| 'flush'
	| 'full-house'
	| 'four-kind'
	| 'straight-flush';

export type HandRank = {
	category: HandCategory;
	primary: number[];
	kickers: number[];
};

export type PublicPlayer = {
	id: PlayerId;
	name: string;
	isHuman: boolean;
	personality?: Personality;
	alive: boolean;
	folded: boolean;
	allIn: boolean;
	betThisHand: number;
};

export type ActionRecord = {
	stage: Stage;
	playerId: PlayerId;
	decision: Decision;
};

export type DecisionInput = {
	stage: Stage;
	myBetThisHand: number;
	myHoleCards: [Card, Card];
	communityCards: Card[];
	alivePlayers: PublicPlayer[];
	activePlayers: PublicPlayer[];
	actionHistory: ActionRecord[];
	pendingAllIn: boolean;
};

export interface AiDecider {
	decide(input: DecisionInput): Promise<Decision>;
}

export const stubAiDecider: AiDecider = {
	decide: () => Promise.resolve({ action: 'call' })
};

export type Player = PublicPlayer & {
	holeCards: [Card, Card];
};

export type GameState = {
	status: 'idle' | 'playing' | 'showdown';
	stage: Stage | null;
	players: Player[];
	communityCards: Card[];
	deck: Card[];
	currentActorId: PlayerId | null;
	actionHistory: ActionRecord[];
	actedThisStage: PlayerId[];
	pendingAllIn: boolean;
};

export type GameEvent =
	| { type: 'start-game'; deck?: Card[] }
	| { type: 'player-action'; playerId: PlayerId; decision: Decision }
	| { type: 'ai-think-expired'; playerId: PlayerId; decision: Decision }
	| { type: 'timer-expired'; timerId: string };

export type EngineResult = {
	state: GameState;
	effects: never[];
};

export const initialState: GameState = {
	status: 'idle',
	stage: null,
	players: [],
	communityCards: [],
	deck: [],
	currentActorId: null,
	actionHistory: [],
	actedThisStage: [],
	pendingAllIn: false
};

const seats = [
	{ id: 'human', name: '人类', isHuman: true },
	{ id: 'ai-1', name: 'AI-1', isHuman: false, personality: 'conservative' },
	{ id: 'ai-2', name: 'AI-2', isHuman: false, personality: 'balanced' },
	{ id: 'ai-3', name: 'AI-3', isHuman: false, personality: 'aggressive' }
] as const satisfies readonly Pick<PublicPlayer, 'id' | 'name' | 'isHuman' | 'personality'>[];

const seatOrder = seats.map((seat) => seat.id);

const categoryScore: Record<HandCategory, number> = {
	'high-card': 0,
	'one-pair': 1,
	'two-pair': 2,
	'three-kind': 3,
	straight: 4,
	flush: 5,
	'full-house': 6,
	'four-kind': 7,
	'straight-flush': 8
};

const rankValue: Record<Rank, number> = {
	'2': 2,
	'3': 3,
	'4': 4,
	'5': 5,
	'6': 6,
	'7': 7,
	'8': 8,
	'9': 9,
	'10': 10,
	J: 11,
	Q: 12,
	K: 13,
	A: 14
};

export const defaultDeck: Card[] = [
	{ rank: 'A', suit: '♠' },
	{ rank: 'K', suit: '♠' },
	{ rank: 'Q', suit: '♥' },
	{ rank: 'J', suit: '♥' },
	{ rank: '10', suit: '♦' },
	{ rank: '9', suit: '♦' },
	{ rank: '8', suit: '♣' },
	{ rank: '7', suit: '♣' },
	{ rank: '2', suit: '♠' },
	{ rank: '3', suit: '♠' },
	{ rank: '4', suit: '♠' },
	{ rank: '5', suit: '♠' },
	{ rank: '6', suit: '♠' }
];

export function createDecisionInput(
	state: GameState,
	playerId: PlayerId
): Result.Result<DecisionInput, EngineError> {
	const player = state.players.find((candidate) => candidate.id === playerId);
	if (!state.stage || !player) return Result.fail('missing-decision-input');

	const publicPlayers = state.players.map(({ holeCards: _holeCards, ...publicPlayer }) => publicPlayer);

	return Result.succeed({
		stage: state.stage,
		myBetThisHand: player.betThisHand,
		myHoleCards: player.holeCards,
		communityCards: state.communityCards,
		alivePlayers: publicPlayers.filter((candidate) => candidate.alive),
		activePlayers: publicPlayers.filter((candidate) => candidate.alive && !candidate.folded),
		actionHistory: state.actionHistory,
		pendingAllIn: state.pendingAllIn
	});
}

export async function decideForAi(
	decider: AiDecider,
	state: GameState,
	playerId: PlayerId
): Promise<Result.Result<Decision, EngineError>> {
	const input = createDecisionInput(state, playerId);
	if (Result.isFailure(input)) return Result.fail(input.failure);

	try {
		return Result.succeed(await decider.decide(input.success));
	} catch {
		return Result.succeed({ action: 'fold' });
	}
}

export function createWeightedAiDecider(personality: Personality, random = Math.random): AiDecider {
	return { decide: (input) => Promise.resolve(weightedAiDecision(personality, input.stage, random)) };
}

export function weightedAiDecision(
	personality: Personality,
	stage: Stage,
	random = Math.random,
	legalActions?: readonly Decision['action'][]
): Decision {
	const weights: Record<Personality, Record<Decision['action'], number>> = {
		conservative: { call: 0.25, fold: 0.65, 'all-in': 0.1 },
		balanced: { call: 0.4, fold: 0.3, 'all-in': 0.3 },
		aggressive: { call: 0.5, fold: 0.15, 'all-in': 0.35 }
	};
	const allowed = new Set<Decision['action']>(legalActions ?? ['call', 'fold', 'all-in']);
	const entries = (Object.entries(weights[personality]) as [Decision['action'], number][]).filter(
		([action]) => allowed.has(action) && (stage !== 'river' || action !== 'all-in')
	);
	if (entries.length === 0) return { action: 'fold' };
	const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
	let roll = random() * total;
	for (const [action, weight] of entries) {
		roll -= weight;
		if (roll < 0) return { action };
	}
	return { action: entries[entries.length - 1]?.[0] ?? 'fold' };
}

export function randomThinkDelayMs(random = Math.random) {
	return 3000 + Math.floor(random() * 2001);
}

export function compareHands(left: HandRank, right: HandRank) {
	const category = categoryScore[left.category] - categoryScore[right.category];
	if (category !== 0) return Math.sign(category);
	return compareNumbers([...left.primary, ...left.kickers], [...right.primary, ...right.kickers]);
}

export function evaluateBestHand(cards: Card[]): Result.Result<HandRank, EngineError> {
	if (cards.length !== 7) return Result.fail('invalid-card-count');
	let best: HandRank | null = null;
	for (let a = 0; a < cards.length - 4; a += 1)
		for (let b = a + 1; b < cards.length - 3; b += 1)
			for (let c = b + 1; c < cards.length - 2; c += 1)
				for (let d = c + 1; d < cards.length - 1; d += 1)
					for (let e = d + 1; e < cards.length; e += 1) {
						const hand = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
						if (!best || compareHands(hand, best) > 0) best = hand;
					}
	return Result.succeed(best!);
}

export function engine(state: GameState, event: GameEvent): EngineResult {
	if (event.type === 'timer-expired') return { state, effects: [] };
	if (event.type === 'start-game') return { state: startGame(event.deck ?? defaultDeck), effects: [] };
	if (state.status !== 'playing') return { state, effects: [] };
	if (event.type === 'player-action' || event.type === 'ai-think-expired') {
		if (event.playerId !== state.currentActorId) return { state, effects: [] };
		return { state: applyDecision(state, event.playerId, event.decision), effects: [] };
	}
	return { state, effects: [] };
}

function startGame(deck: Card[]): GameState {
	return {
		status: 'playing',
		stage: 'preflop',
		players: seats.map((seat, index) => ({
			...seat,
			alive: true,
			folded: false,
			allIn: false,
			betThisHand: 1,
			holeCards: [deck[index * 2]!, deck[index * 2 + 1]!]
		})),
		communityCards: [],
		deck: deck.slice(8),
		currentActorId: 'human',
		actionHistory: [],
		actedThisStage: [],
		pendingAllIn: false
	};
}

function applyDecision(state: GameState, playerId: PlayerId, decision: Decision): GameState {
	// ponytail: All-in 留到切片 5；本切片忽略误发事件，避免进入半实现状态。
	if (decision.action === 'all-in') return state;
	const players = state.players.map((player) => {
		if (player.id !== playerId) return player;
		return {
			...player,
			betThisHand: decision.action === 'call' ? player.betThisHand + 1 : player.betThisHand,
			folded: decision.action === 'fold' ? true : player.folded,
			allIn: player.allIn
		};
	});
	const next: GameState = {
		...state,
		players,
		pendingAllIn: players.some((player) => player.alive && !player.folded && player.allIn),
		actionHistory: [...state.actionHistory, { stage: state.stage!, playerId, decision }],
		actedThisStage: [...new Set([...state.actedThisStage, playerId])]
	};
	return advance(next);
}

function advance(state: GameState): GameState {
	if (roundComplete(state)) {
		if (state.stage === 'river') return { ...state, status: 'showdown', currentActorId: null };
		return nextStage(state);
	}
	return { ...state, currentActorId: nextActor(state) };
}

function nextStage(state: GameState): GameState {
	const stage = ({ preflop: 'flop', flop: 'turn', turn: 'river' } as const)[state.stage as Exclude<Stage, 'river'>];
	const revealCount = stage === 'flop' ? 3 : 1;
	const communityCards = [...state.communityCards, ...state.deck.slice(0, revealCount)];
	const reset: GameState = {
		...state,
		stage,
		communityCards,
		deck: state.deck.slice(revealCount),
		actedThisStage: []
	};
	return { ...reset, currentActorId: firstActor(reset) };
}

function roundComplete(state: GameState) {
	return activePlayers(state).every((player) => state.actedThisStage.includes(player.id));
}

function firstActor(state: GameState) {
	return seatOrder.find((id) => activePlayers(state).some((player) => player.id === id)) ?? null;
}

function nextActor(state: GameState) {
	const active = activePlayers(state);
	const currentIndex = seatOrder.indexOf(state.currentActorId!);
	return (
		seatOrder
			.slice(currentIndex + 1)
			.concat(seatOrder.slice(0, currentIndex + 1))
			.find((id) => active.some((player) => player.id === id && !state.actedThisStage.includes(id))) ?? null
	);
}

function activePlayers(state: GameState) {
	return state.players.filter((player) => player.alive && !player.folded);
}

function evaluateFive(cards: [Card, Card, Card, Card, Card]): HandRank {
	const values = cards.map((card) => rankValue[card.rank]).sort((a, b) => b - a);
	const flush = cards.every((card) => card.suit === cards[0].suit);
	const straightHigh = getStraightHigh(values);
	const counts = new Map<number, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	const groups = [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || b.value - a.value);

	if (flush && straightHigh) return { category: 'straight-flush', primary: [straightHigh], kickers: [] };
	if (groups[0]!.count === 4)
		return { category: 'four-kind', primary: [groups[0]!.value], kickers: [groups[1]!.value] };
	if (groups[0]!.count === 3 && groups[1]!.count === 2)
		return { category: 'full-house', primary: [groups[0]!.value, groups[1]!.value], kickers: [] };
	if (flush) return { category: 'flush', primary: [], kickers: values };
	if (straightHigh) return { category: 'straight', primary: [straightHigh], kickers: [] };
	if (groups[0]!.count === 3)
		return {
			category: 'three-kind',
			primary: [groups[0]!.value],
			kickers: groups.slice(1).map((group) => group.value).sort((a, b) => b - a)
		};
	if (groups[0]!.count === 2 && groups[1]!.count === 2)
		return {
			category: 'two-pair',
			primary: [groups[0]!.value, groups[1]!.value],
			kickers: [groups[2]!.value]
		};
	if (groups[0]!.count === 2)
		return {
			category: 'one-pair',
			primary: [groups[0]!.value],
			kickers: groups.slice(1).map((group) => group.value).sort((a, b) => b - a)
		};
	return { category: 'high-card', primary: [], kickers: values };
}

function getStraightHigh(values: number[]) {
	const unique = [...new Set(values)].sort((a, b) => b - a);
	if (unique.length !== 5) return 0;
	if (unique.join(',') === '14,5,4,3,2') return 5;
	return unique[0]! - unique[4]! === 4 ? unique[0]! : 0;
}

function compareNumbers(left: number[], right: number[]) {
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return Math.sign(difference);
	}
	return 0;
}
