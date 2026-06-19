import * as Result from 'effect/Result';
import { describe, expect, it, vi } from 'vitest';

import {
  compareHands,
  createDecisionInput,
  decideForAi,
  defaultDeck,
  engine,
  evaluateBestHand,
  initialState,
  randomThinkDelayMs,
  weightedAiDecision,
  type AiDecider,
  type Card,
  type Decision,
  type GameState,
  type HandRank,
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
    state = act(state, 'ai-1', 'fold');
    expect(state.currentActorId).toBe('ai-2');

    state = act(state, 'ai-2');
    state = act(state, 'ai-3');
    expect(state.stage).toBe('flop');
    expect(state.currentActorId).toBe('human');
    expect(state.communityCards.map((card) => `${card.rank}${card.suit}`)).toEqual([
      '2♠',
      '3♠',
      '4♠',
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
