import * as Result from 'effect/Result';

export type Stage = 'preflop' | 'flop' | 'turn' | 'river';
export type PlayerId = 'human' | 'ai-1' | 'ai-2' | 'ai-3';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type Suit = '♠' | '♥' | '♦' | '♣';

export type Card = {
	rank: Rank;
	suit: Suit;
};

export type Decision = { action: 'call' | 'fold' | 'all-in' };
export type EngineError = 'missing-decision-input' | 'ai-decision-failed';

export type PublicPlayer = {
	id: PlayerId;
	name: string;
	isHuman: boolean;
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
	status: 'idle' | 'playing';
	stage: Stage | null;
	players: Player[];
	communityCards: Card[];
	currentActorId: PlayerId | null;
	actionHistory: ActionRecord[];
	pendingAllIn: boolean;
};

export type GameEvent =
	| { type: 'start-game' }
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
	currentActorId: null,
	actionHistory: [],
	pendingAllIn: false
};

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
		return Result.fail('ai-decision-failed');
	}
}

const seats = [
	{ id: 'human', name: '人类', isHuman: true },
	{ id: 'ai-1', name: 'AI-1', isHuman: false },
	{ id: 'ai-2', name: 'AI-2', isHuman: false },
	{ id: 'ai-3', name: 'AI-3', isHuman: false }
] as const satisfies readonly Pick<PublicPlayer, 'id' | 'name' | 'isHuman'>[];

// ponytail: 固定牌堆够本切片验收；需要真实牌局时把洗牌结果作为 start-game 输入。
const openingDeck: Card[] = [
	{ rank: 'A', suit: '♠' },
	{ rank: 'K', suit: '♠' },
	{ rank: 'Q', suit: '♥' },
	{ rank: 'J', suit: '♥' },
	{ rank: '10', suit: '♦' },
	{ rank: '9', suit: '♦' },
	{ rank: '8', suit: '♣' },
	{ rank: '7', suit: '♣' }
];

export function engine(state: GameState, event: GameEvent): EngineResult {
	if (event.type === 'timer-expired') return { state, effects: [] };

	return {
		state: {
			status: 'playing',
			stage: 'preflop',
			players: seats.map((seat, index) => ({
				...seat,
				alive: true,
				folded: false,
				allIn: false,
				betThisHand: 1,
				holeCards: [openingDeck[index * 2]!, openingDeck[index * 2 + 1]!]
			})),
			communityCards: [],
			currentActorId: 'human',
			actionHistory: [],
			pendingAllIn: false
		},
		effects: []
	};
}
