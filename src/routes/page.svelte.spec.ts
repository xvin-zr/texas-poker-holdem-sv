import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('首页', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('点击开始游戏后显示第一手翻牌前桌面', async () => {
		render(Page);

		const start = page.getByRole('button', { name: '开始游戏' });
		await expect.element(start).toBeInTheDocument();
		await start.click();

		await expect.element(page.getByText('当前阶段：翻牌前')).toBeInTheDocument();
		await expect.element(page.getByText('当前行动者：人类')).toBeInTheDocument();
		expect(page.getByTestId('seat').elements()).toHaveLength(4);
		expect(page.getByText('本手下注：1 颗子弹').elements()).toHaveLength(4);
		expect(page.getByText('身份：人类').elements()).toHaveLength(1);
		expect(page.getByText('身份：AI').elements()).toHaveLength(3);
		expect(page.getByText('存活').elements()).toHaveLength(4);
		expect(page.getByTestId('human-hole-card').elements()).toHaveLength(2);
		expect(page.getByTestId('ai-hole-card-hidden').elements()).toHaveLength(6);
		await expect.element(page.getByRole('button', { name: '跟注' })).toBeEnabled();
		await expect.element(page.getByText('翻牌前尚未翻开公共牌')).toBeInTheDocument();
		await expect.element(page.getByText('暂无行动')).toBeInTheDocument();
	});

	it('跟注后显示行动历史，AI 思考结束后串行推进并翻牌', async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, 'random').mockReturnValue(0);
		render(Page);

		await page.getByRole('button', { name: '开始游戏' }).click();
		await page.getByRole('button', { name: '跟注' }).click();

		await expect.element(page.getByText('人类 在 翻牌前 选择 跟注')).toBeInTheDocument();
		await expect.element(page.getByText('AI-1 正在思考…')).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(9000);

		await expect.element(page.getByText('当前阶段：翻牌')).toBeInTheDocument();
		await expect.element(page.getByText('当前行动者：人类')).toBeInTheDocument();
		expect(page.getByTestId('community-card').elements()).toHaveLength(3);
		await expect.element(page.getByText('AI-3 在 翻牌前 选择 跟注')).toBeInTheDocument();
	});
});
