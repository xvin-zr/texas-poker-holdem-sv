import * as Match from 'effect/Match';
import * as Result from 'effect/Result';

export type Stage = 'preflop' | 'flop' | 'turn' | 'river';
export type PlayerId = 'human' | 'ai-1' | 'ai-2' | 'ai-3';
export type AiPlayerId = Exclude<PlayerId, 'human'>;
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type Suit = '♠' | '♥' | '♦' | '♣';
export type Personality = 'conservative' | 'balanced' | 'aggressive';

export type Card = {
  rank: Rank;
  suit: Suit;
};

export type Decision = { action: 'call' | 'fold' | 'all-in' };
export type EngineError = 'missing-decision-input' | 'invalid-card-count';

// 弃牌开枪外置定时器：引擎发 effect 让 UI 层 2.5s 后回灌 fold-shoot-expired 事件。
export const FOLD_SHOOT_DELAY_MS = 2500;
export const SHOWDOWN_SHOOT_DELAY_MS = 2500;
export const ALL_IN_HUMAN_TIMEOUT_MS = 10000;
export const ALL_IN_SETTLEMENT_CHOICE_DELAY_MS = 0;
export const ALL_IN_SETTLEMENT_FOLD_SHOOT_DELAY_MS = 2500;
export const ALL_IN_SETTLEMENT_REVEAL_DELAY_MS = 1000;
export const ALL_IN_SETTLEMENT_SHOWDOWN_DELAY_MS = 2500;
export const FOLD_SHOOT_CAP_PROBABILITY = 0.95;
export type EngineEffect =
  | { type: 'schedule-fold-shoot'; playerId: PlayerId; timerId: string }
  | { type: 'schedule-showdown-shoot'; loserIds: PlayerId[]; timerId: string };
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

export type ShowdownEntry = {
  playerId: PlayerId;
  hand: HandRank;
  result: 'winner' | 'loser' | 'tie';
};

export type ShowdownState = {
  entries: ShowdownEntry[];
  loserIds: PlayerId[];
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

export type AllInWaitState = {
  timerId: string;
  triggerPlayerId: PlayerId;
  responderIds: PlayerId[];
  respondedIds: PlayerId[];
  timedOutIds: PlayerId[];
};

export type AllInSettlementStep = 'pending' | 'choices' | 'fold-shoot' | 'reveal';

export type ShootResult = {
  playerId: PlayerId;
  died: boolean;
};

export type AllInSettlementState = {
  timerId: string;
  step: AllInSettlementStep;
  triggerPlayerId: PlayerId;
  responderIds: PlayerId[];
  allInPlayerIds: PlayerId[];
  foldedPlayerIds: PlayerId[];
  timedOutIds: PlayerId[];
  foldShootResults: ShootResult[];
  showdown: ShowdownState | null;
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
  decide: () => Promise.resolve({ action: 'call' }),
};

export type Player = PublicPlayer & {
  holeCards: [Card, Card];
};

export type GameStatus =
  | 'idle'
  | 'playing'
  | 'all-in-settle'
  | 'showdown'
  | 'hand-resolved'
  | 'won';

// 手结束且 ≥2 存活时的结算暂停判别器；UI 据此展示「本手结算」与「开始下一手」按钮。
export type HandResolution =
  | { kind: 'showdown'; diedIds: PlayerId[] }
  | { kind: 'all-in'; diedIds: PlayerId[] }
  | { kind: 'void'; voidPlayerId: PlayerId };

export type GameState = {
  status: GameStatus;
  stage: Stage | null;
  players: Player[];
  communityCards: Card[];
  deck: Card[];
  currentActorId: PlayerId | null;
  actionHistory: ActionRecord[];
  actedThisStage: PlayerId[];
  pendingAllIn: boolean;
  allInWait: AllInWaitState | null;
  allInSettlement: AllInSettlementState | null;
  // 弃牌开枪阻塞期间记录待开枪玩家，行动轮暂停直到 fold-shoot-expired 回灌。
  pendingFoldShoot: PlayerId | null;
  showdown: ShowdownState | null;
  // hand-resolved 状态下保留上一手结算的判别器；won 状态透传最后一手结果给胜利屏。
  handResolution: HandResolution | null;
  winnerId: PlayerId | null;
  // 第一局随机分配、跨局固定保留的 AI 性格（人类无性格）。
  aiPersonalities: Record<AiPlayerId, Personality> | null;
};

export type GameEvent =
  | { type: 'start-game'; deck?: Card[]; personalities?: Record<AiPlayerId, Personality> }
  | { type: 'player-action'; playerId: PlayerId; decision: Decision }
  | { type: 'ai-think-expired'; playerId: PlayerId; decision: Decision }
  | { type: 'all-in-timeout'; playerId: PlayerId }
  | { type: 'timer-expired'; timerId: string }
  | { type: 'all-in-settlement-choices-expired' }
  | {
      type: 'all-in-settlement-fold-shoot-expired';
      rolls: Partial<Record<PlayerId, number>>;
    }
  | { type: 'all-in-settlement-reveal-expired' }
  | {
      type: 'all-in-settlement-showdown-expired';
      rolls: Partial<Record<PlayerId, number>>;
    }
  | {
      type: 'fold-shoot-expired';
      playerId: PlayerId;
      roll: number;
    }
  | {
      type: 'showdown-shoot-expired';
      rolls: Partial<Record<PlayerId, number>>;
    }
  | { type: 'next-hand'; deck: Card[] };

export type FoldShootExpired = Extract<GameEvent, { type: 'fold-shoot-expired' }>;
export type AllInSettlementEvent = Extract<
  GameEvent,
  {
    type:
      | 'all-in-settlement-choices-expired'
      | 'all-in-settlement-fold-shoot-expired'
      | 'all-in-settlement-reveal-expired'
      | 'all-in-settlement-showdown-expired';
  }
>;

export type EngineResult = {
  state: GameState;
  effects: EngineEffect[];
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
  pendingAllIn: false,
  allInWait: null,
  allInSettlement: null,
  pendingFoldShoot: null,
  showdown: null,
  handResolution: null,
  winnerId: null,
  aiPersonalities: null,
};

// 弃牌开枪死亡概率 = betThisHand ÷ 8，≥8 封顶 95%。roll 由外层注入保持 reducer 纯净。
export function foldShootDeathProbability(betThisHand: number): number {
  return betThisHand >= 8 ? FOLD_SHOOT_CAP_PROBABILITY : betThisHand / 8;
}

export function shuffleDeck<T>(deck: readonly T[], random = Math.random): T[] {
  const next = [...deck];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [next[index], next[swap]] = [next[swap]!, next[index]!];
  }
  return next;
}

const seats = [
  { id: 'human', name: '人类', isHuman: true },
  { id: 'ai-1', name: 'AI-1', isHuman: false },
  { id: 'ai-2', name: 'AI-2', isHuman: false },
  { id: 'ai-3', name: 'AI-3', isHuman: false },
] as const satisfies readonly Pick<PublicPlayer, 'id' | 'name' | 'isHuman'>[];

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
  'straight-flush': 8,
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
  A: 14,
};

export const defaultDeck: Card[] = [
  { rank: 'A', suit: '♠' },
  { rank: 'A', suit: '♥' },
  { rank: 'K', suit: '♠' },
  { rank: 'Q', suit: '♥' },
  { rank: '10', suit: '♦' },
  { rank: '9', suit: '♦' },
  { rank: '8', suit: '♣' },
  { rank: '7', suit: '♣' },
  { rank: 'A', suit: '♦' },
  { rank: '6', suit: '♦' },
  { rank: '4', suit: '♣' },
  { rank: '3', suit: '♣' },
  { rank: '2', suit: '♥' },
];

export function createDecisionInput(
  state: GameState,
  playerId: PlayerId,
): Result.Result<DecisionInput, EngineError> {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!state.stage || !player) return Result.fail('missing-decision-input');

  const publicPlayers = state.players.map(
    ({ holeCards: _holeCards, ...publicPlayer }) => publicPlayer,
  );

  return Result.succeed({
    stage: state.stage,
    myBetThisHand: player.betThisHand,
    myHoleCards: player.holeCards,
    communityCards: state.communityCards,
    alivePlayers: publicPlayers.filter((candidate) => candidate.alive),
    activePlayers: publicPlayers.filter((candidate) => candidate.alive && !candidate.folded),
    actionHistory: state.actionHistory,
    pendingAllIn: state.pendingAllIn,
  });
}

export function deriveLegalActions(input: DecisionInput): Decision['action'][] {
  const actions: Decision['action'][] = input.pendingAllIn
    ? ['all-in', 'fold']
    : ['call', 'fold', 'all-in'];
  return input.stage === 'river' ? actions.filter((action) => action !== 'all-in') : actions;
}

export async function decideForAi(
  decider: AiDecider,
  state: GameState,
  playerId: PlayerId,
): Promise<Result.Result<Decision, EngineError>> {
  const input = createDecisionInput(state, playerId);
  if (Result.isFailure(input)) return Result.succeed({ action: 'fold' });

  const legalActions = deriveLegalActions(input.success);
  try {
    const decision = await decider.decide(input.success);
    if (!legalActions.includes(decision.action)) return Result.succeed({ action: 'fold' });
    return Result.succeed(decision);
  } catch {
    return Result.succeed({ action: 'fold' });
  }
}

export function createWeightedAiDecider(personality: Personality, random = Math.random): AiDecider {
  return {
    decide: (input) =>
      Promise.resolve(
        weightedAiDecision(
          personality,
          input.stage,
          random,
          input.pendingAllIn ? ['all-in', 'fold'] : undefined,
        ),
      ),
  };
}

export function weightedAiDecision(
  personality: Personality,
  stage: Stage,
  random = Math.random,
  legalActions?: readonly Decision['action'][],
): Decision {
  const weights: Record<Personality, Record<Decision['action'], number>> = {
    conservative: { call: 0.25, fold: 0.65, 'all-in': 0.1 },
    balanced: { call: 0.4, fold: 0.3, 'all-in': 0.3 },
    aggressive: { call: 0.5, fold: 0.15, 'all-in': 0.35 },
  };
  const allowed = new Set<Decision['action']>(legalActions ?? ['call', 'fold', 'all-in']);
  const entries = (Object.entries(weights[personality]) as [Decision['action'], number][]).filter(
    ([action]) => allowed.has(action) && (stage !== 'river' || action !== 'all-in'),
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
  return Match.value(event).pipe(
    Match.when({ type: 'timer-expired' }, () => ({ state, effects: [] })),
    Match.when({ type: 'start-game' }, (startEvent) => ({
      state: startGame(startEvent.deck ?? defaultDeck, state, startEvent.personalities),
      effects: [],
    })),
    Match.whenOr(
      { type: 'all-in-settlement-choices-expired' },
      { type: 'all-in-settlement-fold-shoot-expired' },
      { type: 'all-in-settlement-reveal-expired' },
      { type: 'all-in-settlement-showdown-expired' },
      (settlementEvent) => ({
        state: applyAllInSettlementEvent(state, settlementEvent),
        effects: [],
      }),
    ),
    Match.when({ type: 'showdown-shoot-expired' }, (shootEvent) => ({
      state: applyShowdownShoot(state, shootEvent),
      effects: [],
    })),
    Match.when({ type: 'next-hand' }, (nextHandEvent) => ({
      state: applyNextHand(state, nextHandEvent.deck),
      effects: [],
    })),
    Match.orElse((playingEvent) => applyPlayingEvent(state, playingEvent)),
  );
}

function applyPlayingEvent(state: GameState, event: GameEvent): EngineResult {
  if (state.status !== 'playing') return { state, effects: [] };
  if (event.type === 'fold-shoot-expired')
    return { state: applyFoldShoot(state, event), effects: [] };
  if (state.allInWait) return applyAllInWaitEvent(state, event);
  if (event.type !== 'player-action' && event.type !== 'ai-think-expired')
    return { state, effects: [] };
  if (event.playerId !== state.currentActorId) return { state, effects: [] };
  return applyDecision(state, event.playerId, event.decision);
}

function applyAllInWaitEvent(state: GameState, event: GameEvent): EngineResult {
  return Match.value(event).pipe(
    Match.when({ type: 'all-in-timeout' }, ({ playerId }) => ({
      state: applyAllInTimeout(state, playerId),
      effects: [],
    })),
    Match.whenOr(
      { type: 'player-action' },
      { type: 'ai-think-expired' },
      ({ playerId, decision }) => applyAllInResponse(state, playerId, decision),
    ),
    Match.orElse(() => ({ state, effects: [] })),
  );
}

function assignRandomPersonalities(random = Math.random): Record<AiPlayerId, Personality> {
  const pool: Personality[] = ['conservative', 'balanced', 'aggressive'];
  const shuffled = shuffleDeck(pool, random);
  return { 'ai-1': shuffled[0]!, 'ai-2': shuffled[1]!, 'ai-3': shuffled[2]! };
}

function startGame(
  deck: Card[],
  state: GameState,
  eventPersonalities?: Record<AiPlayerId, Personality>,
): GameState {
  // 性格一旦在第一局分配就跨局固定，后续 start-game 不再接受覆盖。
  const personalities = state.aiPersonalities ?? eventPersonalities ?? assignRandomPersonalities();
  const base: GameState = {
    ...initialState,
    status: 'playing',
    aiPersonalities: personalities,
    players: seats.map((seat) => ({
      ...seat,
      personality: seat.isHuman ? undefined : personalities[seat.id as AiPlayerId],
      alive: true,
      folded: false,
      allIn: false,
      betThisHand: 0,
      holeCards: [defaultDeck[0]!, defaultDeck[1]!],
    })),
  };
  return dealNextHand(base, deck);
}

function applyDecision(state: GameState, playerId: PlayerId, decision: Decision): EngineResult {
  if (decision.action === 'all-in') return applyAllInTrigger(state, playerId, decision);
  if (decision.action === 'fold') return applyFold(state, playerId);

  const players = state.players.map((player) =>
    player.id === playerId ? { ...player, betThisHand: player.betThisHand + 1 } : player,
  );
  const next: GameState = {
    ...state,
    players,
    pendingAllIn: players.some((player) => player.alive && !player.folded && player.allIn),
    actionHistory: [...state.actionHistory, { stage: state.stage!, playerId, decision }],
    actedThisStage: [...new Set([...state.actedThisStage, playerId])],
  };
  return withShowdownEffect(advance(next));
}

function applyAllInTrigger(state: GameState, playerId: PlayerId, decision: Decision): EngineResult {
  if (state.stage === 'river') return { state, effects: [] };
  const players = state.players.map((player) =>
    player.id === playerId ? { ...player, allIn: true, betThisHand: 8 } : player,
  );
  const responderIds = players
    .filter((player) => player.id !== playerId && player.alive && !player.folded && !player.allIn)
    .map((player) => player.id);
  const next: GameState = {
    ...state,
    players,
    currentActorId: null,
    actionHistory: [...state.actionHistory, { stage: state.stage!, playerId, decision }],
    actedThisStage: [],
    pendingAllIn: responderIds.length > 0,
    allInWait: {
      timerId: `all-in:${state.actionHistory.length + 1}:${playerId}`,
      triggerPlayerId: playerId,
      responderIds,
      respondedIds: [],
      timedOutIds: [],
    },
    allInSettlement: null,
  };
  return { state: responderIds.length === 0 ? enterAllInSettlement(next) : next, effects: [] };
}

function applyAllInResponse(
  state: GameState,
  playerId: PlayerId,
  decision: Decision,
  timedOut = false,
): EngineResult {
  const wait = state.allInWait;
  if (!wait || decision.action === 'call') return { state, effects: [] };
  if (!wait.responderIds.includes(playerId) || wait.respondedIds.includes(playerId))
    return { state, effects: [] };

  const players = state.players.map((player) => {
    if (player.id !== playerId) return player;
    return decision.action === 'all-in'
      ? { ...player, allIn: true, folded: false, betThisHand: 8 }
      : { ...player, folded: true };
  });
  const nextWait: AllInWaitState = {
    ...wait,
    respondedIds: [...wait.respondedIds, playerId],
    timedOutIds: timedOut ? [...wait.timedOutIds, playerId] : wait.timedOutIds,
  };
  const next: GameState = {
    ...state,
    players,
    currentActorId: null,
    actionHistory: [...state.actionHistory, { stage: state.stage!, playerId, decision }],
    actedThisStage: [],
    pendingAllIn: true,
    allInWait: nextWait,
  };
  return {
    state:
      nextWait.respondedIds.length === nextWait.responderIds.length
        ? enterAllInSettlement(next)
        : next,
    effects: [],
  };
}

function applyAllInTimeout(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player?.isHuman) return state;
  return applyAllInResponse(state, playerId, { action: 'fold' }, true).state;
}

function enterAllInSettlement(state: GameState): GameState {
  const wait = state.allInWait;
  if (!wait) return state;
  return {
    ...state,
    status: 'all-in-settle',
    currentActorId: null,
    pendingAllIn: false,
    allInWait: null,
    allInSettlement: {
      timerId: wait.timerId,
      step: 'pending',
      triggerPlayerId: wait.triggerPlayerId,
      responderIds: wait.responderIds,
      allInPlayerIds: state.players
        .filter((player) => player.alive && !player.folded && player.allIn)
        .map((player) => player.id),
      foldedPlayerIds: wait.responderIds.filter(
        (id) => state.players.find((player) => player.id === id)?.folded,
      ),
      timedOutIds: wait.timedOutIds,
      foldShootResults: [],
      showdown: null,
    },
  };
}

// 弃牌（非 All-in）：标记 folded、阻塞行动轮、外置 2.5s 开枪定时器。
// 玩家已退出本手牌型比较，但生死要等开枪结算。
function applyFold(state: GameState, playerId: PlayerId): EngineResult {
  const timerId = `fold-shoot:${playerId}`;
  const players = state.players.map((player) =>
    player.id === playerId ? { ...player, folded: true } : player,
  );
  const next: GameState = {
    ...state,
    players,
    actionHistory: [
      ...state.actionHistory,
      { stage: state.stage!, playerId, decision: { action: 'fold' } },
    ],
    actedThisStage: [...new Set([...state.actedThisStage, playerId])],
    currentActorId: null,
    pendingFoldShoot: playerId,
  };
  return { state: next, effects: [{ type: 'schedule-fold-shoot', playerId, timerId }] };
}

// 弃牌开枪到期：按 betThisHand 水位判生死，致死作废本手 / 胜利，存活退出本手继续。
function applyFoldShoot(state: GameState, event: FoldShootExpired): GameState {
  if (state.pendingFoldShoot !== event.playerId) return state;
  const player = state.players.find((candidate) => candidate.id === event.playerId);
  if (!player) return state;

  const died = event.roll < foldShootDeathProbability(player.betThisHand);
  if (!died) {
    // 存活：从弃牌者位置继续扫描下一活跃玩家，避免依赖 currentActorId=null 的隐式行为。
    const surviving: GameState = {
      ...state,
      pendingFoldShoot: null,
      currentActorId: event.playerId,
    };
    return advance(surviving);
  }

  const players = state.players.map((candidate) =>
    candidate.id === event.playerId ? { ...candidate, alive: false } : candidate,
  );
  const survivors = players.filter((candidate) => candidate.alive);
  if (survivors.length <= 1) {
    return {
      ...state,
      players,
      status: 'won',
      winnerId: survivors[0]?.id ?? null,
      currentActorId: null,
      pendingFoldShoot: null,
      handResolution: { kind: 'void', voidPlayerId: event.playerId },
    };
  }

  // 致死且 ≥2 存活：本手作废，暂停进入 hand-resolved，等待玩家点「开始下一手」再洗牌。
  return {
    ...state,
    players,
    status: 'hand-resolved',
    currentActorId: null,
    pendingFoldShoot: null,
    handResolution: { kind: 'void', voidPlayerId: event.playerId },
  };
}

function applyAllInSettlementEvent(state: GameState, event: AllInSettlementEvent): GameState {
  if (state.status !== 'all-in-settle' || !state.allInSettlement) return state;
  return Match.value(event).pipe(
    Match.when({ type: 'all-in-settlement-choices-expired' }, () => revealAllInChoices(state)),
    Match.when({ type: 'all-in-settlement-fold-shoot-expired' }, ({ rolls }) =>
      shootAllInFolders(state, rolls),
    ),
    Match.when({ type: 'all-in-settlement-reveal-expired' }, () => revealAllInCards(state)),
    Match.when({ type: 'all-in-settlement-showdown-expired' }, ({ rolls }) =>
      shootAllInLosers(state, rolls),
    ),
    Match.exhaustive,
  );
}

function revealAllInChoices(state: GameState): GameState {
  const settlement = state.allInSettlement;
  if (!settlement || settlement.step !== 'pending') return state;
  const won = winIfOnlyOneAlive(state);
  if (won) return won;
  return { ...state, allInSettlement: { ...settlement, step: 'choices' } };
}

function shootAllInFolders(state: GameState, rolls: Partial<Record<PlayerId, number>>): GameState {
  const settlement = state.allInSettlement;
  if (!settlement || settlement.step !== 'choices') return state;
  const won = winIfOnlyOneAlive(state);
  if (won) return won;

  const folded = new Set(settlement.foldedPlayerIds);
  const results: ShootResult[] = [];
  const players = state.players.map((player) => {
    if (!folded.has(player.id) || !player.alive) return player;
    const died = (rolls[player.id] ?? 1) < foldShootDeathProbability(player.betThisHand);
    results.push({ playerId: player.id, died });
    return died ? { ...player, alive: false } : player;
  });
  const next: GameState = {
    ...state,
    players,
    allInSettlement: { ...settlement, step: 'fold-shoot', foldShootResults: results },
  };
  return winIfOnlyOneAlive(next) ?? next;
}

function revealAllInCards(state: GameState): GameState {
  const settlement = state.allInSettlement;
  if (!settlement || settlement.step !== 'fold-shoot') return state;
  const won = winIfOnlyOneAlive(state);
  if (won) return won;

  const revealed = revealCommunityToRiver(state);
  return {
    ...revealed,
    allInSettlement: {
      ...settlement,
      step: 'reveal',
      showdown: buildAllInShowdown(revealed, settlement.allInPlayerIds),
    },
  };
}

function shootAllInLosers(state: GameState, rolls: Partial<Record<PlayerId, number>>): GameState {
  const settlement = state.allInSettlement;
  if (!settlement || settlement.step !== 'reveal') return state;
  // 预置判别器，让提前胜利路径也能透传 handResolution 到胜利屏。
  const seeded: GameState = {
    ...state,
    handResolution: { kind: 'all-in', diedIds: [] },
  };
  const won = winIfOnlyOneAlive(seeded);
  if (won) return won;

  const showdown = settlement.showdown ?? buildAllInShowdown(seeded, settlement.allInPlayerIds);
  const losers = new Set(showdown.loserIds);
  const players = seeded.players.map((player) => {
    if (!losers.has(player.id)) return player;
    const died = (rolls[player.id] ?? 1) < foldShootDeathProbability(player.betThisHand);
    return died ? { ...player, alive: false } : player;
  });
  const diedIds = showdown.loserIds.filter(
    (id) => !players.find((player) => player.id === id)!.alive,
  );
  const settled: GameState = {
    ...seeded,
    players,
    allInSettlement: { ...settlement, showdown },
    handResolution: { kind: 'all-in', diedIds },
  };
  const final = winIfOnlyOneAlive(settled);
  if (final) return final;
  // 暂停进入 hand-resolved，保留 allInSettlement/showdown 供 UI 展示。
  return {
    ...settled,
    status: 'hand-resolved',
    currentActorId: null,
  };
}

function winIfOnlyOneAlive(state: GameState): GameState | null {
  const survivors = state.players.filter((player) => player.alive);
  if (survivors.length > 1) return null;
  return {
    ...state,
    status: 'won',
    currentActorId: null,
    pendingAllIn: false,
    allInWait: null,
    pendingFoldShoot: null,
    // 保留 allInSettlement/showdown/handResolution 供胜利屏展示最后一手结果。
    winnerId: survivors[0]?.id ?? null,
  };
}

function withShowdownEffect(state: GameState): EngineResult {
  return {
    state,
    effects:
      state.status === 'showdown' && state.showdown && state.showdown.loserIds.length > 0
        ? [
            {
              type: 'schedule-showdown-shoot',
              timerId: 'showdown-shoot',
              loserIds: state.showdown.loserIds,
            },
          ]
        : [],
  };
}

function applyShowdownShoot(
  state: GameState,
  event: Extract<GameEvent, { type: 'showdown-shoot-expired' }>,
): GameState {
  if (state.status !== 'showdown' || !state.showdown) return state;
  const losers = new Set(state.showdown.loserIds);
  const players = state.players.map((player) => {
    if (!losers.has(player.id)) return player;
    const died = (event.rolls[player.id] ?? 1) < foldShootDeathProbability(player.betThisHand);
    return died ? { ...player, alive: false } : player;
  });
  const survivors = players.filter((player) => player.alive);
  const diedIds = state.showdown.loserIds.filter(
    (id) => !players.find((player) => player.id === id)!.alive,
  );
  const resolution: HandResolution = { kind: 'showdown', diedIds };
  if (survivors.length <= 1) {
    return {
      ...state,
      players,
      status: 'won',
      currentActorId: null,
      pendingFoldShoot: null,
      handResolution: resolution,
      winnerId: survivors[0]?.id ?? null,
    };
  }
  // 暂停进入 hand-resolved，保留 showdown 供 UI 展示，等待玩家点「开始下一手」。
  return {
    ...state,
    players,
    status: 'hand-resolved',
    currentActorId: null,
    pendingFoldShoot: null,
    handResolution: resolution,
  };
}

function advance(state: GameState): GameState {
  if (roundComplete(state)) {
    if (state.stage === 'river') return enterShowdown(state);
    return nextStage(state);
  }
  return { ...state, currentActorId: nextActor(state) };
}

function enterShowdown(state: GameState): GameState {
  const revealed = revealCommunityToRiver(state);
  return {
    ...revealed,
    status: 'showdown',
    currentActorId: null,
    showdown: buildShowdown(revealed),
  };
}

function revealCommunityToRiver(state: GameState): GameState {
  const missingCommunity = Math.max(0, 5 - state.communityCards.length);
  return {
    ...state,
    communityCards: [...state.communityCards, ...state.deck.slice(0, missingCommunity)],
    deck: state.deck.slice(missingCommunity),
  };
}

function buildShowdown(state: GameState): ShowdownState {
  return buildShowdownForPlayers(state, activePlayers(state));
}

function buildAllInShowdown(state: GameState, playerIds: PlayerId[]): ShowdownState {
  const allowed = new Set(playerIds);
  return buildShowdownForPlayers(
    state,
    state.players.filter((player) => allowed.has(player.id) && player.alive && !player.folded),
  );
}

function buildShowdownForPlayers(state: GameState, players: Player[]): ShowdownState {
  const ranked = players
    .map((player) => {
      const result = evaluateBestHand([...player.holeCards, ...state.communityCards]);
      return Result.isSuccess(result) ? { playerId: player.id, hand: result.success } : null;
    })
    .filter((entry): entry is Omit<ShowdownEntry, 'result'> => entry !== null);
  const best = ranked.reduce<HandRank | null>(
    (current, entry) => (!current || compareHands(entry.hand, current) > 0 ? entry.hand : current),
    null,
  );
  const allTied = best ? ranked.every((entry) => compareHands(entry.hand, best) === 0) : true;
  const entries = ranked.map((entry): ShowdownEntry => {
    const isBest = best ? compareHands(entry.hand, best) === 0 : true;
    return {
      ...entry,
      result: ranked.length === 1 || !allTied ? (isBest ? 'winner' : 'loser') : 'tie',
    };
  });
  return {
    entries,
    loserIds: entries.filter((entry) => entry.result === 'loser').map((entry) => entry.playerId),
  };
}

function nextStage(state: GameState): GameState {
  const stage = ({ preflop: 'flop', flop: 'turn', turn: 'river' } as const)[
    state.stage as Exclude<Stage, 'river'>
  ];
  const revealCount = stage === 'flop' ? 3 : 1;
  const communityCards = [...state.communityCards, ...state.deck.slice(0, revealCount)];
  const reset: GameState = {
    ...state,
    stage,
    communityCards,
    deck: state.deck.slice(revealCount),
    actedThisStage: [],
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
      .find((id) =>
        active.some((player) => player.id === id && !state.actedThisStage.includes(id)),
      ) ?? null
  );
}

function activePlayers(state: GameState) {
  return state.players.filter((player) => player.alive && !player.folded);
}

// 玩家在 hand-resolved 状态点「开始下一手」：清空上一手结算数据，发新一手。
function applyNextHand(state: GameState, deck: Card[]): GameState {
  if (state.status !== 'hand-resolved') return state;
  return dealNextHand(
    {
      ...state,
      pendingFoldShoot: null,
      showdown: null,
      allInSettlement: null,
      handResolution: null,
      winnerId: null,
    },
    deck,
  );
}

// 发新一手：仅存活玩家参与，每人 Ante 1 颗，重新发底牌。死者保留 alive=false 不参与。
function dealNextHand(state: GameState, deck: Card[]): GameState {
  let cardIndex = 0;
  const players = state.players.map((player) => {
    if (!player.alive) return player;
    const holeCards: [Card, Card] = [deck[cardIndex]!, deck[cardIndex + 1]!];
    cardIndex += 2;
    return { ...player, folded: false, allIn: false, betThisHand: 1, holeCards };
  });
  const reset: GameState = {
    ...state,
    status: 'playing',
    stage: 'preflop',
    players,
    communityCards: [],
    deck: deck.slice(cardIndex),
    actionHistory: [],
    actedThisStage: [],
    currentActorId: null,
    pendingAllIn: false,
    allInWait: null,
    allInSettlement: null,
    pendingFoldShoot: null,
    showdown: null,
    winnerId: null,
  };
  return { ...reset, currentActorId: firstActor(reset) };
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

  if (flush && straightHigh)
    return { category: 'straight-flush', primary: [straightHigh], kickers: [] };
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
      kickers: groups
        .slice(1)
        .map((group) => group.value)
        .sort((a, b) => b - a),
    };
  if (groups[0]!.count === 2 && groups[1]!.count === 2)
    return {
      category: 'two-pair',
      primary: [groups[0]!.value, groups[1]!.value],
      kickers: [groups[2]!.value],
    };
  if (groups[0]!.count === 2)
    return {
      category: 'one-pair',
      primary: [groups[0]!.value],
      kickers: groups
        .slice(1)
        .map((group) => group.value)
        .sort((a, b) => b - a),
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
