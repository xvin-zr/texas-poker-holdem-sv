import * as Result from 'effect/Result';
import { describe, expect, it, vi } from 'vitest';

import {
  ALL_IN_HUMAN_TIMEOUT_MS,
  compareHands,
  createDecisionInput,
  decideForAi,
  deriveLegalActions,
  defaultDeck,
  engine,
  evaluateBestHand,
  foldShootDeathProbability,
  initialState,
  shuffleDeck,
  weightedAiDecision,
  type AiDecider,
  type AiPlayerId,
  type Card,
  type Decision,
  type DecisionInput,
  type GameState,
  type HandRank,
  type Personality,
  type PlayerId,
} from './engine';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const unwrap = <T, E>(result: Result.Result<T, E>) => {
  expect(Result.isSuccess(result)).toBe(true);
  return (result as { success: T }).success;
};
const act = (
  state: GameState,
  playerId: NonNullable<GameState['currentActorId']>,
  action: Decision['action'] = 'call',
) => engine(state, { type: 'player-action', playerId, decision: { action } }).state;

// 弃牌后立即以存活结果结算开枪（roll 足够大 → 不死），用于需要继续推进的测试。
const foldSurvive = (state: GameState, playerId: PlayerId) => {
  const folded = engine(state, {
    type: 'player-action',
    playerId,
    decision: { action: 'fold' },
  });
  return engine(folded.state, {
    type: 'fold-shoot-expired',
    playerId,
    roll: 0.999,
  }).state;
};
const callAllFour = (state: GameState) => {
  let result = { state, effects: [] } as ReturnType<typeof engine>;
  for (const playerId of ['human', 'ai-1', 'ai-2', 'ai-3'] as const) {
    result = engine(result.state, {
      type: 'player-action',
      playerId,
      decision: { action: 'call' },
    });
  }
  return result;
};
const playToShowdown = (
  deck: Card[] = defaultDeck,
  personalities?: Record<AiPlayerId, Personality>,
) => {
  let result = {
    state: engine(initialState, { type: 'start-game', deck, personalities }).state,
    effects: [],
  } as ReturnType<typeof engine>;
  result = callAllFour(result.state);
  result = callAllFour(result.state);
  result = callAllFour(result.state);
  return callAllFour(result.state);
};
const allInEveryone = (deck: Card[] = defaultDeck) => {
  let state = engine(initialState, { type: 'start-game', deck }).state;
  state = engine(state, {
    type: 'player-action',
    playerId: 'human',
    decision: { action: 'all-in' },
  }).state;
  for (const playerId of ['ai-1', 'ai-2', 'ai-3'] as const) {
    state = engine(state, {
      type: 'ai-think-expired',
      playerId,
      decision: { action: 'all-in' },
    }).state;
  }
  return state;
};
const allInWithFoldedResponders = () => {
  let state = engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
  state = act(state, 'human');
  state = engine(state, {
    type: 'player-action',
    playerId: 'ai-1',
    decision: { action: 'all-in' },
  }).state;
  state = engine(state, {
    type: 'player-action',
    playerId: 'human',
    decision: { action: 'fold' },
  }).state;
  state = engine(state, {
    type: 'ai-think-expired',
    playerId: 'ai-3',
    decision: { action: 'all-in' },
  }).state;
  return engine(state, {
    type: 'ai-think-expired',
    playerId: 'ai-2',
    decision: { action: 'fold' },
  }).state;
};
const revealAllInSettlement = (state: GameState, rolls: Partial<Record<PlayerId, number>> = {}) => {
  state = engine(state, { type: 'all-in-settlement-choices-expired' }).state;
  state = engine(state, { type: 'all-in-settlement-fold-shoot-expired', rolls }).state;
  return engine(state, { type: 'all-in-settlement-reveal-expired' }).state;
};
const tieDeck: Card[] = [
  c('A', '♠'),
  c('K', '♠'),
  c('Q', '♥'),
  c('J', '♥'),
  c('10', '♦'),
  c('9', '♦'),
  c('8', '♣'),
  c('7', '♣'),
  c('2', '♠'),
  c('3', '♠'),
  c('4', '♠'),
  c('5', '♠'),
  c('6', '♠'),
];

describe('引擎 reducer', () => {
  it('开始游戏会进入第一手 preflop 初始状态', () => {
    const result = engine(initialState, { type: 'start-game' });
    const human = result.state.players.find((player) => player.id === 'human');

    expect(result.effects).toEqual([]);
    expect(result.state.stage).toBe('preflop');
    expect(result.state.currentActorId).toBe('human');
    expect(result.state.players).toHaveLength(4);
    expect(result.state.players.every((player) => player.alive)).toBe(true);
    expect(result.state.players.every((player) => player.betThisHand === 1)).toBe(true);
    expect(human?.holeCards).toHaveLength(2);
  });

  it('开始游戏是纯 reducer，不会调度定时器', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const personalities = {
      'ai-1': 'conservative',
      'ai-2': 'balanced',
      'ai-3': 'aggressive',
    } as const;

    expect(engine(initialState, { type: 'start-game', personalities })).toEqual(
      engine(initialState, { type: 'start-game', personalities }),
    );
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('AI 决策接口可以替换为测试 stub', async () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const input = createDecisionInput(started, 'ai-1');
    const decider: AiDecider = { decide: async () => ({ action: 'fold' }) };

    expect(Result.isSuccess(input)).toBe(true);
    if (Result.isFailure(input)) return;
    expect(input.success.myHoleCards).toHaveLength(2);
    expect(input.success.alivePlayers).toHaveLength(4);
    expect(input.success.activePlayers).toHaveLength(4);
    await expect(decideForAi(decider, started, 'ai-1')).resolves.toMatchObject({
      _tag: 'Success',
      success: { action: 'fold' },
    });
    await expect(
      decideForAi({ decide: () => Promise.reject('坏决策') }, started, 'ai-1'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'fold' } });
  });

  it('跟注会下注一颗子弹并按固定座位顺序推进', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const afterHuman = act(started, 'human');

    expect(afterHuman.players.find((player) => player.id === 'human')?.betThisHand).toBe(2);
    expect(afterHuman.currentActorId).toBe('ai-1');
    expect(afterHuman.actionHistory).toMatchObject([
      { stage: 'preflop', playerId: 'human', decision: { action: 'call' } },
    ]);
  });

  it('行动轮跳过弃牌者，每个新阶段从人类开始并翻开公共牌', () => {
    let state = engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
    state = act(state, 'human');
    state = foldSurvive(state, 'ai-1');
    expect(state.currentActorId).toBe('ai-2');

    state = act(state, 'ai-2');
    state = act(state, 'ai-3');
    expect(state.stage).toBe('flop');
    expect(state.currentActorId).toBe('human');
    expect(state.communityCards.map((card) => `${card.rank}${card.suit}`)).toEqual([
      'A♦',
      '6♦',
      '4♣',
    ]);

    state = act(state, 'human');
    state = act(state, 'ai-2');
    state = act(state, 'ai-3');
    expect(state.stage).toBe('turn');
    expect(state.communityCards).toHaveLength(4);

    state = act(state, 'human');
    state = act(state, 'ai-2');
    state = act(state, 'ai-3');
    expect(state.stage).toBe('river');
    expect(state.communityCards).toHaveLength(5);
  });

  it('全押会把水位拉到 8 并立即中断行动轮，已 Call 玩家重新待响应', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const afterHumanCall = act(started, 'human');

    const afterAllIn = engine(afterHumanCall, {
      type: 'player-action',
      playerId: 'ai-1',
      decision: { action: 'all-in' },
    }).state;

    expect(afterAllIn.players.find((player) => player.id === 'ai-1')).toMatchObject({
      allIn: true,
      betThisHand: 8,
    });
    expect(afterAllIn.players.find((player) => player.id === 'human')?.betThisHand).toBe(2);
    expect(afterAllIn.currentActorId).toBe(null);
    expect(afterAllIn.actedThisStage).toEqual([]);
    expect(afterAllIn.pendingAllIn).toBe(true);
    expect(afterAllIn.allInWait).toMatchObject({
      triggerPlayerId: 'ai-1',
      responderIds: ['human', 'ai-2', 'ai-3'],
      respondedIds: [],
    });
  });

  it('全押等待允许待响应者并行乱序响应，禁止 Call 与触发者再次行动', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const afterHumanCall = act(started, 'human');
    const waiting = engine(afterHumanCall, {
      type: 'player-action',
      playerId: 'ai-1',
      decision: { action: 'all-in' },
    }).state;

    const callIgnored = engine(waiting, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'call' },
    }).state;
    const triggerIgnored = engine(waiting, {
      type: 'ai-think-expired',
      playerId: 'ai-1',
      decision: { action: 'fold' },
    }).state;
    const ai3First = engine(waiting, {
      type: 'ai-think-expired',
      playerId: 'ai-3',
      decision: { action: 'all-in' },
    }).state;
    const humanFolded = engine(ai3First, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'fold' },
    }).state;
    const settled = engine(humanFolded, {
      type: 'ai-think-expired',
      playerId: 'ai-2',
      decision: { action: 'fold' },
    }).state;

    expect(callIgnored).toEqual(waiting);
    expect(triggerIgnored).toEqual(waiting);
    expect(ai3First.allInWait?.respondedIds).toEqual(['ai-3']);
    expect(ai3First.players.find((player) => player.id === 'ai-3')).toMatchObject({
      allIn: true,
      betThisHand: 8,
    });
    expect(settled.status).toBe('all-in-settle');
    expect(settled.pendingAllIn).toBe(false);
    expect(settled.allInWait).toBe(null);
    expect(settled.allInSettlement).toMatchObject({
      triggerPlayerId: 'ai-1',
      allInPlayerIds: ['ai-1', 'ai-3'],
      foldedPlayerIds: ['human', 'ai-2'],
    });
    // 已 Call 的水位不撤回，后续 5b 开枪按这个水位算。
    expect(settled.players.find((player) => player.id === 'human')).toMatchObject({
      folded: true,
      betThisHand: 2,
    });
  });

  it('全押等待的人类超时会自动弃牌，AI 超时事件被忽略', () => {
    expect(ALL_IN_HUMAN_TIMEOUT_MS).toBe(10000);
    const started = engine(initialState, { type: 'start-game' }).state;
    const afterHumanCall = act(started, 'human');
    const waiting = engine(afterHumanCall, {
      type: 'player-action',
      playerId: 'ai-1',
      decision: { action: 'all-in' },
    }).state;

    const aiTimeoutIgnored = engine(waiting, { type: 'all-in-timeout', playerId: 'ai-2' }).state;
    const humanTimedOut = engine(waiting, { type: 'all-in-timeout', playerId: 'human' }).state;

    expect(aiTimeoutIgnored).toEqual(waiting);
    expect(humanTimedOut.players.find((player) => player.id === 'human')?.folded).toBe(true);
    expect(humanTimedOut.allInWait?.respondedIds).toEqual(['human']);
    expect(humanTimedOut.allInWait?.timedOutIds).toEqual(['human']);
    expect(humanTimedOut.status).toBe('playing');
  });

  it('全押待响应者为 0 时立即进入结算占位', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const onlyHumanActive = {
      ...started,
      players: started.players.map((player) =>
        player.id === 'human' ? player : { ...player, folded: true },
      ),
    } satisfies GameState;

    const settled = engine(onlyHumanActive, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'all-in' },
    }).state;

    expect(settled.status).toBe('all-in-settle');
    expect(settled.allInWait).toBe(null);
    expect(settled.allInSettlement).toMatchObject({
      triggerPlayerId: 'human',
      responderIds: [],
      allInPlayerIds: ['human'],
    });
  });

  it('河牌阶段引擎拒绝全押', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const river = {
      ...started,
      stage: 'river',
      currentActorId: 'human',
      communityCards: defaultDeck.slice(8, 13),
    } satisfies GameState;

    const rejected = engine(river, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'all-in' },
    }).state;

    expect(rejected).toEqual(river);
  });

  it('AI 思考到期事件才会应用决策', () => {
    const waiting = act(engine(initialState, { type: 'start-game' }).state, 'human');
    const unchanged = engine(waiting, { type: 'timer-expired', timerId: 'ai-1' }).state;
    const decided = engine(waiting, {
      type: 'ai-think-expired',
      playerId: 'ai-1',
      decision: { action: 'call' },
    }).state;

    expect(unchanged).toEqual(waiting);
    expect(decided.players.find((player) => player.id === 'ai-1')?.betThisHand).toBe(2);
    expect(decided.currentActorId).toBe('ai-2');
  });
});

describe('All-in 结算时间轴', () => {
  it('由 t=0/2.5/3.5/6 到期事件逐步推进', () => {
    let state = allInWithFoldedResponders();

    expect(state.status).toBe('all-in-settle');
    expect(state.allInSettlement?.step).toBe('pending');

    state = engine(state, { type: 'all-in-settlement-choices-expired' }).state;
    expect(state.allInSettlement?.step).toBe('choices');

    state = engine(state, {
      type: 'all-in-settlement-fold-shoot-expired',
      rolls: { human: 0.999, 'ai-2': 0.999 },
    }).state;
    expect(state.allInSettlement?.step).toBe('fold-shoot');
    expect(state.communityCards).toHaveLength(0);
    expect(state.players.find((player) => player.id === 'human')?.alive).toBe(true);
    expect(state.players.find((player) => player.id === 'ai-2')?.alive).toBe(true);

    state = engine(state, { type: 'all-in-settlement-reveal-expired' }).state;
    expect(state.allInSettlement?.step).toBe('reveal');
    expect(state.communityCards).toHaveLength(5);
    expect(state.allInSettlement?.showdown?.entries.map((entry) => entry.playerId)).toEqual([
      'ai-1',
      'ai-3',
    ]);

    state = engine(state, {
      type: 'all-in-settlement-showdown-expired',
      rolls: { 'ai-3': 0.999 },
    }).state;
    expect(state.status).toBe('hand-resolved');
    expect(state.handResolution).toMatchObject({ kind: 'all-in' });
    expect(state.allInSettlement).not.toBe(null);

    state = engine(state, { type: 'next-hand', deck: defaultDeck }).state;
    expect(state.status).toBe('playing');
    expect(state.stage).toBe('preflop');
    expect(state.allInSettlement).toBe(null);
    expect(state.handResolution).toBe(null);
  });

  it('t=2.5 弃牌玩家同时开枪并按各自已抬高水位判定', () => {
    let state = allInWithFoldedResponders();
    state = engine(state, { type: 'all-in-settlement-choices-expired' }).state;

    state = engine(state, {
      type: 'all-in-settlement-fold-shoot-expired',
      // 人类已 Call 到 2：0.2 < 2/8 会死；AI-2 仍为 1：0.2 >= 1/8 存活。
      rolls: { human: 0.2, 'ai-2': 0.2 },
    }).state;

    expect(state.players.find((player) => player.id === 'human')).toMatchObject({
      alive: false,
      betThisHand: 2,
    });
    expect(state.players.find((player) => player.id === 'ai-2')).toMatchObject({
      alive: true,
      betThisHand: 1,
    });
    expect(state.allInSettlement?.foldShootResults).toEqual([
      { playerId: 'human', died: true },
      { playerId: 'ai-2', died: false },
    ]);
  });

  it('每步前与弃牌开枪后都会按 ≤1 存活短路到胜利', () => {
    let state = allInWithFoldedResponders();
    state = {
      ...state,
      players: state.players.map((player) =>
        player.id === 'ai-3' ? { ...player, alive: false } : player,
      ),
    };
    state = engine(state, { type: 'all-in-settlement-choices-expired' }).state;

    const wonAfterFoldShoot = engine(state, {
      type: 'all-in-settlement-fold-shoot-expired',
      rolls: { human: 0, 'ai-2': 0 },
    }).state;

    expect(wonAfterFoldShoot.status).toBe('won');
    expect(wonAfterFoldShoot.winnerId).toBe('ai-1');
    expect(wonAfterFoldShoot.communityCards).toHaveLength(0);

    const wonBeforeReveal = engine(
      {
        ...state,
        allInSettlement: { ...state.allInSettlement!, step: 'fold-shoot' },
        players: state.players.map((player) =>
          player.id === 'ai-1' ? player : { ...player, alive: false },
        ),
      },
      { type: 'all-in-settlement-reveal-expired' },
    ).state;

    expect(wonBeforeReveal.status).toBe('won');
    expect(wonBeforeReveal.winnerId).toBe('ai-1');
    expect(wonBeforeReveal.communityCards).toHaveLength(0);
  });

  it('t=6 复数输者同时开枪，平局与单人全押无人开枪', () => {
    const allInReveal = revealAllInSettlement(allInEveryone(defaultDeck));
    const won = engine(allInReveal, {
      type: 'all-in-settlement-showdown-expired',
      rolls: { 'ai-1': 0, 'ai-2': 0, 'ai-3': 0 },
    }).state;

    expect(allInReveal.allInSettlement?.showdown?.loserIds).toEqual(['ai-1', 'ai-2', 'ai-3']);
    expect(won.status).toBe('won');
    expect(won.winnerId).toBe('human');

    const tieReveal = revealAllInSettlement(allInEveryone(tieDeck));
    const tieResolved = engine(tieReveal, {
      type: 'all-in-settlement-showdown-expired',
      rolls: { human: 0, 'ai-1': 0, 'ai-2': 0, 'ai-3': 0 },
    }).state;

    expect(tieReveal.allInSettlement?.showdown?.loserIds).toEqual([]);
    expect(
      tieReveal.allInSettlement?.showdown?.entries.every((entry) => entry.result === 'tie'),
    ).toBe(true);
    expect(tieResolved.status).toBe('hand-resolved');
    expect(tieResolved.handResolution).toMatchObject({ kind: 'all-in', diedIds: [] });

    const tieNext = engine(tieResolved, { type: 'next-hand', deck: defaultDeck }).state;
    expect(tieNext.status).toBe('playing');
    expect(tieNext.players.every((player) => player.alive)).toBe(true);
    expect(tieNext.allInSettlement).toBe(null);

    let single = engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
    single = engine(single, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'all-in' },
    }).state;
    for (const playerId of ['ai-1', 'ai-2', 'ai-3'] as const) {
      single = engine(single, {
        type: 'ai-think-expired',
        playerId,
        decision: { action: 'fold' },
      }).state;
    }
    const singleReveal = revealAllInSettlement(single, {
      'ai-1': 0.999,
      'ai-2': 0.999,
      'ai-3': 0.999,
    });
    const singleResolved = engine(singleReveal, {
      type: 'all-in-settlement-showdown-expired',
      rolls: {},
    }).state;

    expect(singleReveal.allInSettlement?.showdown?.loserIds).toEqual([]);
    expect(singleReveal.allInSettlement?.showdown?.entries).toMatchObject([
      { playerId: 'human', result: 'winner' },
    ]);
    expect(singleResolved.status).toBe('hand-resolved');

    const singleNext = engine(singleResolved, { type: 'next-hand', deck: defaultDeck }).state;
    expect(singleNext.status).toBe('playing');
    expect(singleNext.players.every((player) => player.alive)).toBe(true);
  });
});

describe('弃牌开枪', () => {
  it('弃牌后行动轮阻塞并外置 2.5s 开枪定时器，不内置 setTimeout', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const started = engine(initialState, { type: 'start-game' }).state;

    const result = engine(started, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'fold' },
    });

    expect(result.effects).toEqual([
      { type: 'schedule-fold-shoot', playerId: 'human', timerId: 'fold-shoot:human' },
    ]);
    expect(result.state.currentActorId).toBe(null);
    expect(result.state.pendingFoldShoot).toBe('human');
    expect(result.state.players.find((player) => player.id === 'human')?.folded).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('fold-shoot-expired 事件驱动生死判定，存活则退出本手并继续行动轮', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const folded = engine(started, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'fold' },
    }).state;

    const survived = engine(folded, {
      type: 'fold-shoot-expired',
      playerId: 'human',
      roll: 0.999,
    }).state;

    expect(survived.pendingFoldShoot).toBe(null);
    expect(survived.players.find((player) => player.id === 'human')?.alive).toBe(true);
    expect(survived.players.find((player) => player.id === 'human')?.folded).toBe(true);
    expect(survived.currentActorId).toBe('ai-1');
  });

  it('存活退出后场上只剩 1 名活跃玩家不判整局胜利，但该玩家本手自动获胜', () => {
    // 只剩人类与 ai-1 活跃，其余两手提前死亡移除。
    const started = engine(initialState, { type: 'start-game' }).state;
    const onlyTwo = {
      ...started,
      players: started.players.map((player) =>
        player.id === 'ai-2' || player.id === 'ai-3' ? { ...player, alive: false } : player,
      ),
    } as GameState;

    // 人类跟注后 ai-1 弃牌存活 → 仅剩人类活跃；仍有 2 名存活，不判整局胜利，但人类本手自动获胜。
    const afterHuman = act(onlyTwo, 'human');
    const folded = engine(afterHuman, {
      type: 'player-action',
      playerId: 'ai-1',
      decision: { action: 'fold' },
    }).state;
    const survived = engine(folded, {
      type: 'fold-shoot-expired',
      playerId: 'ai-1',
      roll: 0.999,
    }).state;

    expect(survived.status).toBe('hand-resolved');
    expect(survived.winnerId).toBe(null);
    expect(survived.handResolution).toEqual({ kind: 'fold-win', handWinnerId: 'human' });
    expect(survived.currentActorId).toBe(null);
    expect(survived.players.filter((player) => player.alive)).toHaveLength(2);
  });

  it('死亡且 ≥2 存活 → 本手作废、洗牌进下一手，死者移除且下注不退还', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    // 人类多跟注几次抬高水位，保证开枪致死。
    let state = act(started, 'human');
    state = act(state, 'ai-1');
    state = act(state, 'ai-2');
    state = act(state, 'ai-3');
    // flop：人类再跟注到 betThisHand=3，仍 <8，用 roll=0 强制致死
    state = act(state, 'human');

    const folded = engine(state, {
      type: 'player-action',
      playerId: 'ai-1',
      decision: { action: 'fold' },
    }).state;
    const voided = engine(folded, {
      type: 'fold-shoot-expired',
      playerId: 'ai-1',
      roll: 0,
    }).state;

    expect(voided.status).toBe('hand-resolved');
    expect(voided.handResolution).toEqual({ kind: 'void', voidPlayerId: 'ai-1' });
    expect(voided.players.find((player) => player.id === 'ai-1')?.alive).toBe(false);

    const nextDeck = shuffleDeck(defaultDeck, () => 0);
    const next = engine(voided, { type: 'next-hand', deck: nextDeck }).state;
    expect(next.status).toBe('playing');
    expect(next.stage).toBe('preflop');
    // 其他人下注不退还：新一手 ante 重置为 1（本手下注不退还体现为本手作废重开）
    expect(
      next.players.filter((player) => player.alive).every((player) => player.betThisHand === 1),
    ).toBe(true);
    expect(next.players.filter((player) => player.alive)).toHaveLength(3);
    expect(next.actionHistory).toEqual([]);
    expect(next.currentActorId).toBe('human');
    expect(next.handResolution).toBe(null);
  });

  it('死亡且仅剩 1 存活 → 触发胜利判定（占位）', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const onlyTwo = {
      ...started,
      players: started.players.map((player) =>
        player.id === 'ai-2' || player.id === 'ai-3' ? { ...player, alive: false } : player,
      ),
    } as GameState;

    // 人类跟注后 ai-1 弃牌致死 → 仅剩人类存活 → 胜利。
    const afterHuman = act(onlyTwo, 'human');
    const folded = engine(afterHuman, {
      type: 'player-action',
      playerId: 'ai-1',
      decision: { action: 'fold' },
    }).state;
    const won = engine(folded, {
      type: 'fold-shoot-expired',
      playerId: 'ai-1',
      roll: 0,
    }).state;

    expect(won.status).toBe('won');
    expect(won.winnerId).toBe('human');
    expect(won.players.find((player) => player.id === 'ai-1')?.alive).toBe(false);
    // 优先级锁定：仅剩 1 名存活时走整局胜利，不误判为 fold-win 本手获胜。
    expect(won.handResolution).toEqual({ kind: 'void', voidPlayerId: 'ai-1' });
  });

  it('死亡概率 = betThisHand ÷ 8，≥8 封顶 95%', () => {
    expect(foldShootDeathProbability(1)).toBeCloseTo(0.125);
    expect(foldShootDeathProbability(5)).toBeCloseTo(0.625);
    expect(foldShootDeathProbability(7)).toBeCloseTo(0.875);
    expect(foldShootDeathProbability(8)).toBe(0.95);
    expect(foldShootDeathProbability(12)).toBe(0.95);
  });

  it('各水位生死边界：roll < 概率致死，roll ≥ 概率存活', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    // betThisHand=1 → 0.125
    const folded1 = engine(started, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'fold' },
    }).state;
    expect(
      engine(folded1, {
        type: 'fold-shoot-expired',
        playerId: 'human',
        roll: 0.124,
      }).state.players.find((player) => player.id === 'human')?.alive,
    ).toBe(false);
    const folded2 = engine(started, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'fold' },
    }).state;
    expect(
      engine(folded2, {
        type: 'fold-shoot-expired',
        playerId: 'human',
        roll: 0.126,
      }).state.players.find((player) => player.id === 'human')?.alive,
    ).toBe(true);
  });

  it('Fold 底牌状态保持隐藏：弃牌玩家底牌不翻开（引擎不改底牌可见性）', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const humanHole = started.players.find((player) => player.id === 'human')?.holeCards;
    const folded = engine(started, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'fold' },
    }).state;
    const survived = engine(folded, {
      type: 'fold-shoot-expired',
      playerId: 'human',
      roll: 0.999,
    }).state;

    expect(survived.players.find((player) => player.id === 'human')?.holeCards).toEqual(humanHole);
  });

  it('死亡玩家从整局移除，后续手行动顺序跳过死者', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    let state = act(started, 'human');
    // ai-1 弃牌致死（roll=0），其余 3 存活 → 本手作废进下一手
    const folded = engine(state, {
      type: 'player-action',
      playerId: 'ai-1',
      decision: { action: 'fold' },
    }).state;
    state = engine(folded, {
      type: 'fold-shoot-expired',
      playerId: 'ai-1',
      roll: 0,
    }).state;
    expect(state.status).toBe('hand-resolved');
    state = engine(state, {
      type: 'next-hand',
      deck: shuffleDeck(defaultDeck, () => 0),
    }).state;

    expect(state.players.find((player) => player.id === 'ai-1')?.alive).toBe(false);
    expect(state.currentActorId).toBe('human');
    // 新一手人类跟注后，下一行动者应跳过已死的 ai-1，落到 ai-2
    state = act(state, 'human');
    expect(state.currentActorId).toBe('ai-2');
  });

  it('存活退出后场上只剩 1 名活跃玩家 → 该玩家本手自动获胜，进入本手结算等待下一手', () => {
    // 人类跟注后，ai-1/ai-2/ai-3 依次弃牌存活 → 仅剩人类活跃，无人阵亡。
    const started = engine(initialState, { type: 'start-game' }).state;
    let state = act(started, 'human');
    state = foldSurvive(state, 'ai-1');
    state = foldSurvive(state, 'ai-2');
    state = foldSurvive(state, 'ai-3');

    // 仅剩人类活跃，但仍有 4 名存活玩家 → 不判整局胜利，本手由人类自动获胜。
    expect(state.status).toBe('hand-resolved');
    expect(state.winnerId).toBe(null);
    expect(state.handResolution).toEqual({ kind: 'fold-win', handWinnerId: 'human' });
    expect(state.currentActorId).toBe(null);
    expect(state.players.filter((player) => player.alive)).toHaveLength(4);

    // 玩家点「开始下一手」后正常发起新一手。
    const next = engine(state, { type: 'next-hand', deck: shuffleDeck(defaultDeck, () => 0) }).state;
    expect(next.status).toBe('playing');
    expect(next.stage).toBe('preflop');
    expect(next.currentActorId).toBe('human');
    expect(next.handResolution).toBe(null);
  });

  it('pendingFoldShoot 不匹配的 fold-shoot-expired 事件被忽略', () => {
    const started = engine(initialState, { type: 'start-game' }).state;
    const folded = engine(started, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'fold' },
    }).state;
    const ignored = engine(folded, {
      type: 'fold-shoot-expired',
      playerId: 'ai-1',
      roll: 0,
    }).state;

    expect(ignored).toEqual(folded);
  });
});

describe('摊牌', () => {
  it('河牌行动轮结束会进入摊牌，翻到 river 并标出赢家与输者', () => {
    const result = playToShowdown();

    expect(result.state.status).toBe('showdown');
    expect(result.state.currentActorId).toBe(null);
    expect(result.state.communityCards).toHaveLength(5);
    expect(result.effects).toEqual([
      {
        type: 'schedule-showdown-shoot',
        timerId: 'showdown-shoot',
        loserIds: ['ai-1', 'ai-2', 'ai-3'],
      },
    ]);
    expect(result.state.showdown?.entries).toHaveLength(4);
    expect(result.state.showdown?.entries.find((entry) => entry.playerId === 'human')?.result).toBe(
      'winner',
    );
    expect(result.state.showdown?.loserIds).toEqual(['ai-1', 'ai-2', 'ai-3']);
    expect(result.state.players.every((player) => player.betThisHand === 5)).toBe(true);
  });

  it('Fold 玩家不参与摊牌比较，底牌状态不被引擎改写', () => {
    const started = engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
    const foldedHole = started.players.find((player) => player.id === 'ai-1')?.holeCards;
    const river = {
      ...started,
      stage: 'river',
      communityCards: defaultDeck.slice(8, 13),
      deck: [],
      currentActorId: 'human',
      actedThisStage: ['ai-2', 'ai-3'],
      players: started.players.map((player) =>
        player.id === 'ai-1'
          ? { ...player, folded: true, betThisHand: 4 }
          : { ...player, betThisHand: player.id === 'human' ? 4 : 5 },
      ),
    } satisfies GameState;

    const result = engine(river, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'call' },
    }).state;

    expect(result.status).toBe('showdown');
    expect(result.showdown?.entries.map((entry) => entry.playerId)).not.toContain('ai-1');
    expect(result.players.find((player) => player.id === 'ai-1')?.holeCards).toEqual(foldedHole);
  });

  it('全平局无人开枪，摊牌结算后直接进入下一手', () => {
    const result = playToShowdown(tieDeck);
    const showdown = result.state;

    expect(result.effects).toEqual([]);
    expect(showdown.showdown?.loserIds).toEqual([]);
    expect(showdown.showdown?.entries.every((entry) => entry.result === 'tie')).toBe(true);

    const resolved = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: {},
    }).state;
    expect(resolved.status).toBe('hand-resolved');
    expect(resolved.handResolution).toEqual({ kind: 'showdown', diedIds: [] });
    expect(resolved.showdown).not.toBe(null);

    const next = engine(resolved, { type: 'next-hand', deck: defaultDeck }).state;

    expect(next.status).toBe('playing');
    expect(next.stage).toBe('preflop');
    expect(next.players.every((player) => player.alive)).toBe(true);
    expect(next.players.every((player) => player.betThisHand === 1)).toBe(true);
    expect(next.actionHistory).toEqual([]);
    expect(next.showdown).toBe(null);
  });

  it('所有非最大者同时开枪，一次结算可让复数输者死亡并触发胜利', () => {
    const showdown = playToShowdown().state;

    const won = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: { 'ai-1': 0, 'ai-2': 0, 'ai-3': 0 },
    }).state;

    expect(won.status).toBe('won');
    expect(won.winnerId).toBe('human');
    expect(won.players.filter((player) => !player.alive).map((player) => player.id)).toEqual([
      'ai-1',
      'ai-2',
      'ai-3',
    ]);
  });

  it('摊牌后仍有两名以上存活者会移除死者并重置本手状态', () => {
    const showdown = playToShowdown().state;

    const resolved = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: { 'ai-1': 0, 'ai-2': 0, 'ai-3': 0.999 },
    }).state;
    expect(resolved.status).toBe('hand-resolved');
    expect(resolved.players.filter((player) => player.alive).map((player) => player.id)).toEqual([
      'human',
      'ai-3',
    ]);

    const next = engine(resolved, { type: 'next-hand', deck: defaultDeck }).state;

    expect(next.status).toBe('playing');
    expect(next.stage).toBe('preflop');
    expect(next.players.filter((player) => player.alive).map((player) => player.id)).toEqual([
      'human',
      'ai-3',
    ]);
    expect(
      next.players.filter((player) => player.alive).every((player) => player.betThisHand === 1),
    ).toBe(true);
    expect(next.communityCards).toEqual([]);
    expect(next.actionHistory).toEqual([]);
    expect(next.currentActorId).toBe('human');
  });
});

describe('牌型评估', () => {
  it('从 7 张牌枚举最优 5 张，A2345 是最小同花顺', () => {
    const hand = unwrap(
      evaluateBestHand([
        c('A', '♠'),
        c('2', '♠'),
        c('3', '♠'),
        c('4', '♠'),
        c('5', '♠'),
        c('K', '♥'),
        c('K', '♦'),
      ]),
    );

    expect(hand).toEqual({ category: 'straight-flush', primary: [5], kickers: [] });
  });

  it('类别、主牌、kicker 依次比较，完全相同为平局', () => {
    const pairA: HandRank = { category: 'one-pair', primary: [14], kickers: [13, 9, 2] };
    const pairK: HandRank = { category: 'one-pair', primary: [13], kickers: [14, 9, 2] };
    const betterKicker: HandRank = { category: 'one-pair', primary: [14], kickers: [13, 10, 2] };

    expect(compareHands(pairA, pairK)).toBe(1);
    expect(compareHands(betterKicker, pairA)).toBe(1);
    expect(compareHands(pairA, { ...pairA })).toBe(0);
  });
});

describe('AI 合法动作', () => {
  it('派生合法动作与加权决策剔除逻辑等价', () => {
    const baseInput = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
      stage: 'preflop',
      myBetThisHand: 1,
      myHoleCards: [c('A', '♠'), c('K', '♠')],
      communityCards: [],
      alivePlayers: [],
      activePlayers: [],
      actionHistory: [],
      pendingAllIn: false,
      ...overrides,
    });

    expect(deriveLegalActions(baseInput())).toEqual(['call', 'fold', 'all-in']);
    expect(deriveLegalActions(baseInput({ stage: 'river' }))).toEqual(['call', 'fold']);
    expect(deriveLegalActions(baseInput({ pendingAllIn: true }))).toEqual(['all-in', 'fold']);
    expect(deriveLegalActions(baseInput({ stage: 'river', pendingAllIn: true }))).toEqual(['fold']);
  });

  it('AI 决策透传合法动作并回退非法与异常', async () => {
    const started = engine(initialState, { type: 'start-game', deck: defaultDeck }).state;

    await expect(
      decideForAi({ decide: async () => ({ action: 'call' }) }, started, 'ai-1'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'call' } });

    await expect(
      decideForAi({ decide: async () => ({ action: 'all-in' }) }, started, 'ai-1'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'all-in' } });

    await expect(
      decideForAi({ decide: async () => ({ action: 'fold' }) }, started, 'ai-1'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'fold' } });

    await expect(
      decideForAi({ decide: () => Promise.reject(new Error('AI 故障')) }, started, 'ai-1'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'fold' } });

    await expect(
      decideForAi(
        { decide: async () => ({ action: 'invalid-action' as Decision['action'] }) },
        started,
        'ai-1',
      ),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'fold' } });
  });

  it('河牌阶段返回全押时回退为弃牌', async () => {
    const started = engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
    const river = { ...started, stage: 'river' as const, currentActorId: 'ai-1' as const };

    await expect(
      decideForAi({ decide: async () => ({ action: 'all-in' }) }, river, 'ai-1'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'fold' } });

    await expect(
      decideForAi({ decide: async () => ({ action: 'call' }) }, river, 'ai-1'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'call' } });
  });

  it('待全押响应阶段只接受全押或弃牌，跟注回退为弃牌', async () => {
    const started = engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
    const waiting = {
      ...started,
      pendingAllIn: true,
      currentActorId: 'ai-2' as const,
    };

    await expect(
      decideForAi({ decide: async () => ({ action: 'call' }) }, waiting, 'ai-2'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'fold' } });

    await expect(
      decideForAi({ decide: async () => ({ action: 'all-in' }) }, waiting, 'ai-2'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'all-in' } });

    await expect(
      decideForAi({ decide: async () => ({ action: 'fold' }) }, waiting, 'ai-2'),
    ).resolves.toMatchObject({ _tag: 'Success', success: { action: 'fold' } });
  });
});

describe('AI 权重', () => {
  it('按性格权重抽取动作，河牌与合法动作集合会剔除全押', () => {
    expect(weightedAiDecision('conservative', 'preflop', () => 0.1)).toEqual({ action: 'call' });
    expect(weightedAiDecision('conservative', 'preflop', () => 0.5)).toEqual({ action: 'fold' });
    expect(weightedAiDecision('aggressive', 'preflop', () => 0.9)).toEqual({ action: 'all-in' });
    expect(weightedAiDecision('aggressive', 'river', () => 0.99).action).not.toBe('all-in');
    expect(weightedAiDecision('aggressive', 'preflop', () => 0.99, ['call', 'fold'])).toEqual({
      action: 'fold',
    });
  });
});

describe('胜利重置与 AI 容错', () => {
  const fixedPersonalities: Record<AiPlayerId, Personality> = {
    'ai-1': 'conservative',
    'ai-2': 'balanced',
    'ai-3': 'aggressive',
  };

  it('胜利屏后 start-game 重置为新局初始状态', () => {
    const showdown = playToShowdown().state;
    const won = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: { 'ai-1': 0, 'ai-2': 0, 'ai-3': 0 },
    }).state;

    expect(won.status).toBe('won');
    expect(won.winnerId).toBe('human');

    const reset = engine(won, { type: 'start-game', deck: defaultDeck }).state;

    expect(reset.status).toBe('playing');
    expect(reset.stage).toBe('preflop');
    expect(reset.communityCards).toEqual([]);
    expect(reset.actionHistory).toEqual([]);
    expect(reset.currentActorId).toBe('human');
    expect(reset.players).toHaveLength(4);
    expect(reset.players.every((player) => player.alive)).toBe(true);
    expect(reset.players.every((player) => !player.folded && !player.allIn)).toBe(true);
    expect(reset.players.every((player) => player.betThisHand === 1)).toBe(true);
    expect(reset.showdown).toBe(null);
    expect(reset.winnerId).toBe(null);
  });

  it('重置保留玩家身份与 AI 性格，不保留任何牌局状态', () => {
    const started = engine(initialState, {
      type: 'start-game',
      deck: defaultDeck,
      personalities: fixedPersonalities,
    }).state;
    const showdown = playToShowdown(defaultDeck, fixedPersonalities).state;
    const won = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: { 'ai-1': 0, 'ai-2': 0, 'ai-3': 0 },
    }).state;

    const reset = engine(won, { type: 'start-game', deck: defaultDeck }).state;

    expect(
      reset.players.map((player) => ({
        id: player.id,
        name: player.name,
        isHuman: player.isHuman,
      })),
    ).toEqual(
      started.players.map((player) => ({
        id: player.id,
        name: player.name,
        isHuman: player.isHuman,
      })),
    );
    expect(reset.aiPersonalities).toEqual(fixedPersonalities);
    expect(reset.players.map((player) => player.personality)).toEqual(
      started.players.map((player) => player.personality),
    );
    // 不保留跨局状态
    expect(reset.deck).not.toEqual(won.deck);
    expect(reset.communityCards).toEqual([]);
    expect(reset.actionHistory).toEqual([]);
  });

  it('第一局随机分配三种性格给三个 AI，之后跨局固定', () => {
    const first = engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
    const assigned = first.aiPersonalities;
    expect(assigned).not.toBe(null);
    const values = Object.values(assigned!);
    expect(values.sort()).toEqual(['aggressive', 'balanced', 'conservative']);

    const showdown = playToShowdown(defaultDeck, assigned!).state;
    const won = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: { 'ai-1': 0, 'ai-2': 0, 'ai-3': 0 },
    }).state;
    const second = engine(won, { type: 'start-game', deck: defaultDeck }).state;

    expect(second.aiPersonalities).toEqual(assigned);
  });

  it('start-game 携带 personalities 也只在第一局生效，不会覆盖已固定性格', () => {
    const first = engine(initialState, {
      type: 'start-game',
      deck: defaultDeck,
      personalities: fixedPersonalities,
    }).state;
    expect(first.aiPersonalities).toEqual(fixedPersonalities);

    const second = engine(first, {
      type: 'start-game',
      deck: defaultDeck,
      personalities: {
        'ai-1': 'aggressive',
        'ai-2': 'aggressive',
        'ai-3': 'aggressive',
      },
    }).state;

    expect(second.aiPersonalities).toEqual(fixedPersonalities);
  });

  it('AI decider 抛异常时 decideForAi 回退为 Fold', async () => {
    const started = engine(initialState, {
      type: 'start-game',
      deck: defaultDeck,
      personalities: fixedPersonalities,
    }).state;
    const throwing: AiDecider = {
      decide: () => Promise.reject(new Error('AI 故障')),
    };

    await expect(decideForAi(throwing, started, 'ai-1')).resolves.toMatchObject({
      _tag: 'Success',
      success: { action: 'fold' },
    });
  });

  it('decideForAi 在缺失决策输入时回退为 Fold', async () => {
    const throwing: AiDecider = {
      decide: async () => ({ action: 'call' }),
    };

    await expect(decideForAi(throwing, initialState, 'ai-1')).resolves.toMatchObject({
      _tag: 'Success',
      success: { action: 'fold' },
    });
  });
});
