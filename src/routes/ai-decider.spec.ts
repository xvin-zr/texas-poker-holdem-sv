import { createDecisionInput, decideForAi, defaultDeck, engine, initialState } from '$lib/engine';
import * as Result from 'effect/Result';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenRouterAiDecider, OPENROUTER_DECISION_TIMEOUT_MS } from './ai-decider';

const startedGame = () => engine(initialState, { type: 'start-game', deck: defaultDeck }).state;
const aiInput = () => {
  const result = createDecisionInput(startedGame(), 'ai-1');
  if (Result.isSuccess(result)) return result.success;
  expect.fail('应能创建 AI 决策输入');
};

describe('OpenRouter AI 决策适配器', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
