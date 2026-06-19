import * as Result from 'effect/Result';
import { describe, expect, it, vi } from 'vitest';

import {
  compareHands,
  createDecisionInput,
  decideForAi,
  defaultDeck,
  engine,
  evaluateBestHand,
  foldShootDeathProbability,
  initialState,
  randomThinkDelayMs,
  shuffleDeck,
  weightedAiDecision,
  type AiDecider,
  type Card,
  type Decision,
  type GameState,
  type HandRank,
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
const foldSurvive = (state: GameState, playerId: PlayerId, nextDeck?: Card[]) => {
  const folded = engine(state, {
    type: 'player-action',
    playerId,
    decision: { action: 'fold' },
  });
  return engine(folded.state, {
    type: 'fold-shoot-expired',
    playerId,
    roll: 0.999,
    nextDeck,
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
const playToShowdown = (deck: Card[] = defaultDeck) => {
  let result = {
    state: engine(initialState, { type: 'start-game', deck }).state,
    effects: [],
  } as ReturnType<typeof engine>;
  result = callAllFour(result.state);
  result = callAllFour(result.state);
  result = callAllFour(result.state);
  return callAllFour(result.state);
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

    expect(engine(initialState, { type: 'start-game' })).toEqual(
      engine(initialState, { type: 'start-game' }),
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

  it('本切片忽略全押事件，避免进入未实现等待状态', () => {
    const started = engine(initialState, { type: 'start-game' }).state;

    const afterAllIn = engine(started, {
      type: 'player-action',
      playerId: 'human',
      decision: { action: 'all-in' },
    }).state;

    expect(afterAllIn).toEqual(started);
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

  it('存活退出时场上只剩 1 名活跃玩家也不直接判胜，而是继续行动轮', () => {
    // 只剩人类与 ai-1 活跃，其余两手提前死亡移除。
    const started = engine(initialState, { type: 'start-game' }).state;
    const onlyTwo = {
      ...started,
      players: started.players.map((player) =>
        player.id === 'ai-2' || player.id === 'ai-3' ? { ...player, alive: false } : player,
      ),
    } as GameState;

    // 人类跟注后 ai-1 弃牌存活 → 仅剩人类活跃，但不判胜，轮到人类继续。
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

    expect(survived.status).toBe('playing');
    expect(survived.winnerId).toBe(null);
    expect(survived.stage).toBe('flop');
    expect(survived.currentActorId).toBe('human');
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
    const nextDeck = shuffleDeck(defaultDeck, () => 0);
    const voided = engine(folded, {
      type: 'fold-shoot-expired',
      playerId: 'ai-1',
      roll: 0,
      nextDeck,
    }).state;

    expect(voided.status).toBe('playing');
    expect(voided.stage).toBe('preflop');
    expect(voided.players.find((player) => player.id === 'ai-1')?.alive).toBe(false);
    // 其他人下注不退还：新一手 ante 重置为 1（本手下注不退还体现为本手作废重开）
    expect(
      voided.players.filter((player) => player.alive).every((player) => player.betThisHand === 1),
    ).toBe(true);
    expect(voided.players.filter((player) => player.alive)).toHaveLength(3);
    expect(voided.actionHistory).toEqual([]);
    expect(voided.currentActorId).toBe('human');
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
      nextDeck: shuffleDeck(defaultDeck, () => 0),
    }).state;

    expect(state.players.find((player) => player.id === 'ai-1')?.alive).toBe(false);
    expect(state.currentActorId).toBe('human');
    // 新一手人类跟注后，下一行动者应跳过已死的 ai-1，落到 ai-2
    state = act(state, 'human');
    expect(state.currentActorId).toBe('ai-2');
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

    const next = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: {},
      nextDeck: defaultDeck,
    }).state;

    expect(next.status).toBe('playing');
    expect(next.stage).toBe('preflop');
    expect(next.players.every((player) => player.alive)).toBe(true);
    expect(next.players.every((player) => player.betThisHand === 1)).toBe(true);
    expect(next.actionHistory).toEqual([]);
  });

  it('所有非最大者同时开枪，一次结算可让复数输者死亡并触发胜利', () => {
    const showdown = playToShowdown().state;

    const won = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: { 'ai-1': 0, 'ai-2': 0, 'ai-3': 0 },
      nextDeck: defaultDeck,
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

    const next = engine(showdown, {
      type: 'showdown-shoot-expired',
      rolls: { 'ai-1': 0, 'ai-2': 0, 'ai-3': 0.999 },
      nextDeck: defaultDeck,
    }).state;

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

  it('AI 思考延时落在 3 到 5 秒', () => {
    expect(randomThinkDelayMs(() => 0)).toBe(3000);
    expect(randomThinkDelayMs(() => 0.9999)).toBe(5000);
  });
});
