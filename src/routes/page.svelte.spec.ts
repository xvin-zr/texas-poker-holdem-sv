import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('首页', () => {
	it('点击开始游戏后显示第一手 preflop 桌面', async () => {
		render(Page);

		const start = page.getByRole('button', { name: '开始游戏' });
		await expect.element(start).toBeInTheDocument();
		await start.click();

		await expect.element(page.getByText('当前阶段：preflop')).toBeInTheDocument();
		await expect.element(page.getByText('当前行动者：人类')).toBeInTheDocument();
		expect(page.getByTestId('seat').elements()).toHaveLength(4);
		expect(page.getByText('本手下注：1 颗子弹').elements()).toHaveLength(4);
		expect(page.getByText('身份：人类').elements()).toHaveLength(1);
		expect(page.getByText('身份：AI').elements()).toHaveLength(3);
		expect(page.getByText('存活').elements()).toHaveLength(4);
		expect(page.getByTestId('human-hole-card').elements()).toHaveLength(2);
		expect(page.getByTestId('ai-hole-card-hidden').elements()).toHaveLength(6);
	});
});
