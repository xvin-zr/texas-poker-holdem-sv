import * as Result from 'effect/Result';
import { describe, expect, it, vi } from 'vitest';
import { createDecisionInput, decideForAi, engine, initialState, type AiDecider } from './engine';

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
			engine(initialState, { type: 'start-game' })
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
			success: { action: 'fold' }
		});
	});
});
