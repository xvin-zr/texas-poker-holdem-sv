import {
  createDecisionInput,
  decideForAi,
  defaultDeck,
  engine,
  initialState,
  type DecisionInput,
  type PlayerId,
} from '$lib/engine';
import * as Result from 'effect/Result';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenRouterAiDecider, OPENROUTER_DECISION_TIMEOUT_MS } from './ai-decider';
import { AiDecisionReqSchema, anonymizeForAiView, visibleGameMessage } from './ai-decision-schema';

const startedGame = () => engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
const aiInput = () => {
  const result = createDecisionInput(startedGame(), 'ai-1');
  if (Result.isSuccess(result)) return result.success;
  expect.fail('应能创建 AI 决策输入');
};

describe('匿名 AI 视图投影', () => {
  it('对手条目剔除 isHuman / name / personality 三键', () => {
    const input = aiInput();
    const view = anonymizeForAiView(input, 'ai-1');

    expect(view.alivePlayers).toHaveLength(input.alivePlayers.length);
    for (const player of view.alivePlayers) {
      expect(player).not.toHaveProperty('isHuman');
      expect(player).not.toHaveProperty('name');
      expect(player).not.toHaveProperty('personality');
    }
  });

  it('自己条目在 alivePlayers / activePlayers 中映射为 me，且 me 不占 seat 编号', () => {
    const input = aiInput();
    const view = anonymizeForAiView(input, 'ai-1');

    const meAlive = view.alivePlayers.find((player) => player.id === 'me');
    const meActive = view.activePlayers.find((player) => player.id === 'me');
    expect(meAlive).toBeDefined();
    expect(meActive).toBeDefined();
    expect(view.alivePlayers.map((player) => player.id).sort()).toEqual([
      'me',
      'seat-1',
      'seat-2',
      'seat-3',
    ]);
  });

  it('按固定枚举顺序为所有 meId 分配确定性 seat 编号', () => {
    const input = aiInput();
    const marker: Record<PlayerId, number> = { human: 10, 'ai-1': 11, 'ai-2': 12, 'ai-3': 13 };
    input.alivePlayers = input.alivePlayers.map((p) => ({ ...p, betThisHand: marker[p.id] }));

    const idsByPlayerId = (meId: PlayerId) =>
      Object.fromEntries(
        anonymizeForAiView(input, meId).alivePlayers.map((p) => [
          Object.entries(marker).find(([, bet]) => bet === p.betThisHand)?.[0],
          p.id,
        ]),
      );

    expect(idsByPlayerId('human')).toEqual({
      human: 'me',
      'ai-1': 'seat-1',
      'ai-2': 'seat-2',
      'ai-3': 'seat-3',
    });
    expect(idsByPlayerId('ai-1')).toEqual({
      human: 'seat-1',
      'ai-1': 'me',
      'ai-2': 'seat-2',
      'ai-3': 'seat-3',
    });
    expect(idsByPlayerId('ai-2')).toEqual({
      human: 'seat-1',
      'ai-1': 'seat-2',
      'ai-2': 'me',
      'ai-3': 'seat-3',
    });
    expect(idsByPlayerId('ai-3')).toEqual({
      human: 'seat-1',
      'ai-1': 'seat-2',
      'ai-2': 'seat-3',
      'ai-3': 'me',
    });
  });

  it('同一对手在 alivePlayers / activePlayers / actionHistory 中使用相同 seat 编号', () => {
    const input = aiInput();
    // 给 ai-3 设置唯一水位，便于在匿名视图中反向定位它。
    input.alivePlayers = input.alivePlayers.map((p) =>
      p.id === 'ai-3' ? { ...p, betThisHand: 5 } : p,
    );
    input.activePlayers = input.activePlayers.map((p) =>
      p.id === 'ai-3' ? { ...p, betThisHand: 5 } : p,
    );
    input.actionHistory.push({
      stage: 'preflop',
      playerId: 'ai-3',
      decision: { action: 'all-in' },
    });

    const view = anonymizeForAiView(input, 'ai-1');
    const aliveId = view.alivePlayers.find((p) => p.betThisHand === 5)?.id;
    const activeId = view.activePlayers.find((p) => p.betThisHand === 5)?.id;
    const historyId = view.actionHistory.find(
      (record) => record.decision.action === 'all-in',
    )?.playerId;

    expect(historyId).toBe('seat-3');
    expect(aliveId).toBe('seat-3');
    expect(activeId).toBe('seat-3');
  });

  it('同一对手在 preflop 与 river 两个输入下 seat 编号相同', () => {
    const preflop = aiInput();
    const river: DecisionInput = { ...preflop, stage: 'river' };

    expect(
      anonymizeForAiView(preflop, 'ai-1')
        .alivePlayers.map((p) => p.id)
        .sort(),
    ).toEqual(
      anonymizeForAiView(river, 'ai-1')
        .alivePlayers.map((p) => p.id)
        .sort(),
    );
  });

  it('非身份字段原样透传', () => {
    const input = aiInput();
    input.actionHistory.push({
      stage: 'preflop',
      playerId: 'human',
      decision: { action: 'call' },
    });

    const view = anonymizeForAiView(input, 'ai-1');

    expect(view.stage).toBe(input.stage);
    expect(view.myBetThisHand).toBe(input.myBetThisHand);
    expect(view.myHoleCards).toEqual(input.myHoleCards);
    expect(view.communityCards).toEqual(input.communityCards);
    expect(view.pendingAllIn).toBe(input.pendingAllIn);
    expect(view.alivePlayers).toHaveLength(input.alivePlayers.length);

    const stateOf = (player: {
      alive: boolean;
      folded: boolean;
      allIn: boolean;
      betThisHand: number;
    }) => ({
      alive: player.alive,
      folded: player.folded,
      allIn: player.allIn,
      betThisHand: player.betThisHand,
    });
    expect(view.alivePlayers.map(stateOf).sort((a, b) => a.betThisHand - b.betThisHand)).toEqual(
      input.alivePlayers.map(stateOf).sort((a, b) => a.betThisHand - b.betThisHand),
    );
    expect(view.activePlayers.map(stateOf).sort((a, b) => a.betThisHand - b.betThisHand)).toEqual(
      input.activePlayers.map(stateOf).sort((a, b) => a.betThisHand - b.betThisHand),
    );
    expect(
      view.actionHistory.map((record) => ({ stage: record.stage, decision: record.decision })),
    ).toEqual(
      input.actionHistory.map((record) => ({ stage: record.stage, decision: record.decision })),
    );
  });
});

describe('OpenRouter AI 决策适配器', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('发给 LLM 的可见信息不会包含任何玩家性格', () => {
    const message = visibleGameMessage(aiInput(), 'ai-1');

    expect(message).not.toContain('conservative');
    expect(message).not.toContain('balanced');
    expect(message).not.toContain('aggressive');
    expect(JSON.parse(message).alivePlayers[0]).not.toHaveProperty('personality');
  });

  it('发给 LLM 的 JSON 不含 isHuman / name / 原始 PlayerId 身份字面量', () => {
    const message = visibleGameMessage(aiInput(), 'ai-1');

    expect(message).not.toContain('isHuman');
    expect(message).not.toContain('name');
    expect(message).not.toContain('human');
    expect(message).not.toContain('ai-1');
    expect(message).not.toContain('ai-2');
    expect(message).not.toContain('ai-3');
  });

  it('远程请求 schema 接受人类玩家没有性格', async () => {
    const input = aiInput();

    const validation = await AiDecisionReqSchema['~standard'].validate({
      input,
      personality: 'balanced',
      legalActions: ['call', 'fold', 'all-in'],
    });

    expect(validation).toHaveProperty('value');
  });

  it('把 DecisionInput、性格和合法动作透传给远程传输', async () => {
    const input = aiInput();
    const transport = vi.fn(async () => ({ action: 'call' as const }));

    await createOpenRouterAiDecider('aggressive', transport).decide(input);

    expect(transport).toHaveBeenCalledWith({
      input,
      personality: 'aggressive',
      legalActions: ['call', 'fold', 'all-in'],
    });
  });

  it('远程传输返回合法动作时由 decideForAi 透传', async () => {
    const state = startedGame();
    const decider = createOpenRouterAiDecider('balanced', async () => ({ action: 'all-in' }));

    await expect(decideForAi(decider, state, 'ai-1')).resolves.toMatchObject({
      _tag: 'Success',
      success: { action: 'all-in' },
    });
  });

  it('远程传输抛错时由 decideForAi 回退弃牌', async () => {
    const state = startedGame();
    const decider = createOpenRouterAiDecider('balanced', () =>
      Promise.reject(new Error('坏传输')),
    );

    await expect(decideForAi(decider, state, 'ai-1')).resolves.toMatchObject({
      _tag: 'Success',
      success: { action: 'fold' },
    });
  });

  it('远程传输无响应超过 30 秒时由 decideForAi 回退弃牌', async () => {
    vi.useFakeTimers();
    const state = startedGame();
    const decider = createOpenRouterAiDecider('balanced', () => new Promise(() => {}));

    const decision = decideForAi(decider, state, 'ai-1');
    await vi.advanceTimersByTimeAsync(OPENROUTER_DECISION_TIMEOUT_MS);

    await expect(decision).resolves.toMatchObject({
      _tag: 'Success',
      success: { action: 'fold' },
    });
  });
});
