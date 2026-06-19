import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

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
    await expect.element(page.getByRole('button', { name: '全押' })).toBeEnabled();
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

  it('河牌阶段禁用全押按钮', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    for (let stage = 0; stage < 3; stage += 1) {
      await page.getByRole('button', { name: '跟注' }).click();
      await vi.advanceTimersByTimeAsync(9000);
    }

    await expect.element(page.getByText('当前阶段：河牌')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '全押' })).toBeDisabled();
  });

  it('AI 全押后显示并行等待，人类 7s 超时自动弃牌进入占位结算', async () => {
    vi.useFakeTimers();
    // AI-1 在翻牌前全押，等待阶段 AI-2/AI-3 独立响应全押。
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '跟注' }).click();
    await vi.advanceTimersByTimeAsync(5000);

    await expect.element(page.getByTestId('all-in-wait-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-countdown')).toHaveTextContent('人类倒计时');
    await expect.element(page.getByTestId('all-in-response-all-in')).toBeEnabled();
    await expect.element(page.getByTestId('all-in-response-fold')).toBeEnabled();
    await expect.element(page.getByRole('button', { name: '跟注' })).toBeDisabled();
    expect(page.getByTestId('all-in-responder').elements()).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(7000);

    await expect.element(page.getByTestId('all-in-settle-placeholder')).toBeInTheDocument();
    await expect.element(page.getByText('人类：超时弃牌')).toBeInTheDocument();
    await expect.element(page.getByText('AI-1：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-2：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-3：全押')).toBeInTheDocument();
  });

  it('人类全押后只让 AI 并行响应，不显示人类倒计时', async () => {
    vi.useFakeTimers();
    // 人类触发全押后，AI-1/2/3 在等待阶段独立响应全押。
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '全押' }).click();

    await expect.element(page.getByTestId('all-in-wait-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-countdown')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-response-all-in')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-response-fold')).not.toBeInTheDocument();
    expect(page.getByTestId('all-in-responder').elements()).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(5000);

    await expect.element(page.getByTestId('all-in-settle-placeholder')).toBeInTheDocument();
    await expect.element(page.getByText('人类：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-1：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-2：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-3：全押')).toBeInTheDocument();
  });

  it('河牌后显示摊牌亮牌，输者同时开枪后出现胜利屏', async () => {
    vi.useFakeTimers();
    // AI 全部跟注，摊牌输者 roll=0 → 5/8 水位下全部死亡。
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    for (let stage = 0; stage < 4; stage += 1) {
      await page.getByRole('button', { name: '跟注' }).click();
      await vi.advanceTimersByTimeAsync(9000);
    }
    await vi.advanceTimersByTimeAsync(0);

    await expect.element(page.getByTestId('showdown-panel')).toBeInTheDocument();
    expect(page.getByTestId('ai-hole-card-revealed').elements()).toHaveLength(6);
    expect(page.getByTestId('showdown-winner').elements()).toHaveLength(1);
    expect(page.getByTestId('showdown-loser').elements()).toHaveLength(3);
    await expect.element(page.getByText('输者 2.5s 后同时开枪…')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2500);

    await expect.element(page.getByTestId('win-screen')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('showdown-shoot-result'))
      .toHaveTextContent('输者开枪：AI-1死亡、AI-2死亡、AI-3死亡');
    await expect.element(page.getByText('人类 是最后一名存活玩家。')).toBeInTheDocument();
  });

  it('弃牌后阻塞行动轮并展示开枪揭示，存活则标记弃牌后继续', async () => {
    vi.useFakeTimers();
    // roll=0.999 → 1/8 水位下存活
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '弃牌' }).click();

    await expect.element(page.getByTestId('fold-shoot-pending')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '跟注' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: '弃牌' })).toBeDisabled();

    await vi.advanceTimersByTimeAsync(2500);

    await expect.element(page.getByTestId('fold-shoot-result')).toHaveTextContent('人类开枪：存活');
    expect(page.getByText('出局').elements()).toHaveLength(0);
    // 存活退出标记：人类座位保留弃牌标记，底牌仍隐藏于其他玩家（AI 底牌不翻开）
    expect(page.getByTestId('folded-badge').elements()).toHaveLength(1);
    expect(page.getByTestId('ai-hole-card-hidden').elements()).toHaveLength(6);
    await expect.element(page.getByText('当前行动者：AI-1')).toBeInTheDocument();
  });

  it('弃牌开枪致死则标记出局并作废本手，进入下一手', async () => {
    vi.useFakeTimers();
    // roll=0 → 1/8 水位下致死
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '弃牌' }).click();

    await vi.advanceTimersByTimeAsync(2500);

    await expect
      .element(page.getByTestId('fold-shoot-result'))
      .toHaveTextContent('人类开枪：死亡·本手作废');
    // 人类出局，其余 3 名存活玩家重开新一手 ante=1
    expect(page.getByText('出局').elements()).toHaveLength(1);
    expect(page.getByText('存活').elements()).toHaveLength(3);
    await expect.element(page.getByText('当前阶段：翻牌前')).toBeInTheDocument();
  });
});
