import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const remoteMock = vi.hoisted(() => {
  type Action = 'call' | 'fold' | 'all-in';
  type Personality = 'conservative' | 'balanced' | 'aggressive';
  const weights: Record<Personality, Record<Action, number>> = {
    conservative: { call: 0.25, fold: 0.65, 'all-in': 0.1 },
    balanced: { call: 0.4, fold: 0.3, 'all-in': 0.3 },
    aggressive: { call: 0.5, fold: 0.15, 'all-in': 0.35 },
  };

  const originalImplementation = async (request: {
    personality: Personality;
    legalActions: Action[];
    input: { stage: string };
  }) => {
    // 远程传输 mock：复刻离线权重，只测试页面外部行为。
    const allowed = new Set(request.legalActions);
    const entries = Object.entries(weights[request.personality]).filter(
      ([action]) =>
        allowed.has(action as Action) &&
        !(request.input.stage === 'river' && action === 'all-in'),
    ) as [Action, number][];
    const candidates = entries.length ? entries : [['fold', 1] as [Action, number]];
    const total = candidates.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = Math.random() * total;
    for (const [action, weight] of candidates) {
      roll -= weight;
      if (roll < 0) return { action };
    }
    return { action: candidates.at(-1)?.[0] ?? 'fold' };
  };

  const fn = vi.fn(originalImplementation);
  return {
    decideAiActionRemote: fn,
    resetImplementation: () => fn.mockImplementation(originalImplementation),
  };
});

vi.mock('./decide.remote', () => remoteMock);

import Page from './+page.svelte';

const flushTimers = async () => {
  for (let count = 0; count < 20; count += 1) await vi.advanceTimersByTimeAsync(1);
};

// 让 AI 远程决策延迟指定毫秒，便于观察 All-in 等待中的 spinner 中间状态。
const delayAiDecisions = (delayMs: number) => {
  const original = remoteMock.decideAiActionRemote.getMockImplementation();
  remoteMock.decideAiActionRemote.mockImplementation(async (request) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (!original) return { action: 'fold' };
    return original(request);
  });
};

// 按顺序强制返回 AI 决策动作与各自思考延迟（不经过性格权重与 Math.random）。
const mockAiActions = (
  actions: Array<{ action: 'call' | 'fold' | 'all-in'; delayMs: number }>,
) => {
  let index = 0;
  remoteMock.decideAiActionRemote.mockImplementation(async () => {
    const { action, delayMs } = actions[index++] ?? { action: 'fold' as const, delayMs: 0 };
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { action };
  });
};

describe('首页', () => {
  afterEach(() => {
    remoteMock.resetImplementation();
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

    await flushTimers();

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
      await flushTimers();
    }

    await expect.element(page.getByText('当前阶段：河牌')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '全押' })).toBeDisabled();
  });

  it('AI 全押后按 t=0/2.5/3.5/6 揭示结算时间轴', async () => {
    vi.useFakeTimers();
    // AI-1 在翻牌前全押，等待阶段 AI-2/AI-3 独立响应全押。
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '跟注' }).click();
    await flushTimers();

    await expect.element(page.getByTestId('all-in-wait-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-countdown')).toHaveTextContent('人类倒计时：10s');
    // 人类作为响应者时，全押/弃牌操作在 alert-dialog 中展示
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-response-all-in')).toBeEnabled();
    await expect.element(page.getByTestId('all-in-response-fold')).toBeEnabled();
    await expect.element(page.getByRole('button', { name: '跟注' })).toBeDisabled();
    expect(page.getByTestId('all-in-responder').elements()).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(10000);
    await flushTimers();

    await expect.element(page.getByTestId('all-in-settle-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-settle-step')).toHaveTextContent('t=0 展示选择');
    await expect.element(page.getByText('人类：超时弃牌')).toBeInTheDocument();
    await expect.element(page.getByText('AI-1：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-2：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-3：全押')).toBeInTheDocument();
    expect(page.getByTestId('ai-hole-card-hidden').elements()).toHaveLength(6);

    await vi.advanceTimersByTimeAsync(2500);

    await expect.element(page.getByTestId('all-in-settle-step')).toHaveTextContent('t=2.5');
    await expect.element(page.getByText('人类：存活')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1000);

    await expect.element(page.getByTestId('all-in-settle-step')).toHaveTextContent('t=6 即将比牌');
    await expect.element(page.getByTestId('all-in-reveal')).toHaveTextContent('公共牌已翻到河牌');
    expect(page.getByTestId('community-card').elements()).toHaveLength(5);
    expect(page.getByTestId('ai-hole-card-revealed').elements()).toHaveLength(6);

    await vi.advanceTimersByTimeAsync(2500);

    // t=6 结算后暂停在 hand-resolved，未自动进下一手
    await expect.element(page.getByTestId('hand-resolved-panel')).toBeInTheDocument();

    await page.getByRole('button', { name: '开始下一手' }).click();

    await expect.element(page.getByText('当前阶段：翻牌前')).toBeInTheDocument();
    expect(page.getByText('存活').elements()).toHaveLength(4);
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

    await flushTimers();

    await expect.element(page.getByTestId('all-in-settle-panel')).toBeInTheDocument();
    await expect.element(page.getByText('人类：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-1：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-2：全押')).toBeInTheDocument();
    await expect.element(page.getByText('AI-3：全押')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2500);

    await expect.element(page.getByTestId('all-in-fold-shoot-empty')).toBeInTheDocument();
  });

  it('全押亮牌前隐藏全押 AI，亮牌时仍隐藏弃牌 AI', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '全押' }).click();
    await flushTimers();

    await expect.element(page.getByTestId('all-in-settle-panel')).toBeInTheDocument();
    await expect.element(page.getByText('AI-1：弃牌')).toBeInTheDocument();
    expect(page.getByTestId('ai-hole-card-hidden').elements()).toHaveLength(6);

    random.mockReturnValue(0.999);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(1000);

    await expect.element(page.getByTestId('all-in-reveal')).toBeInTheDocument();
    expect(page.getByTestId('ai-hole-card-hidden').elements()).toHaveLength(6);
    expect(page.getByTestId('ai-hole-card-revealed').elements()).toHaveLength(0);
  });

  it('全押 t=6 有死亡但仍 ≥2 存活会暂停并清掉结果徽章', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '全押' }).click();
    await flushTimers();
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(1000);

    await expect.element(page.getByTestId('all-in-reveal')).toBeInTheDocument();

    random.mockReset();
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.999).mockReturnValueOnce(0.999);
    random.mockReturnValue(0);
    await vi.advanceTimersByTimeAsync(2500);

    // 结算后暂停在 hand-resolved，徽章仍在展示
    await expect.element(page.getByTestId('hand-resolved-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-shoot-result')).toBeInTheDocument();

    await page.getByRole('button', { name: '开始下一手' }).click();

    await expect.element(page.getByText('当前阶段：翻牌前')).toBeInTheDocument();
    expect(page.getByText('出局').elements()).toHaveLength(1);
    expect(page.getByText('存活').elements()).toHaveLength(3);
    await expect.element(page.getByTestId('all-in-shoot-result')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-fold-shoot-result')).not.toBeInTheDocument();
  });

  it('人类在 alert-dialog 点弃牌响应全押', async () => {
    vi.useFakeTimers();
    // 人类跟注后 AI-1 全押，人类作为响应者在弹窗点弃牌。
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '跟注' }).click();
    await flushTimers();

    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument();
    await page.getByTestId('all-in-response-fold').click();

    // 人类已弃牌，弹窗关闭，进入结算时间轴
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-settle-panel')).toBeInTheDocument();
    await expect.element(page.getByText('人类：弃牌')).toBeInTheDocument();
  });

  it('全押弃牌开枪后仅剩一人会短路到胜利并跳过亮牌', async () => {
    vi.useFakeTimers();
    // AI 全部弃牌且开枪 roll=0 → 三名 AI 死亡，人类直接胜利。
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '全押' }).click();
    await flushTimers();

    await expect.element(page.getByTestId('all-in-settle-panel')).toBeInTheDocument();
    await expect.element(page.getByText('AI-1：弃牌')).toBeInTheDocument();
    await expect.element(page.getByText('AI-2：弃牌')).toBeInTheDocument();
    await expect.element(page.getByText('AI-3：弃牌')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2500);

    await expect.element(page.getByTestId('win-screen')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('all-in-fold-shoot-result'))
      .toHaveTextContent('AI-1死亡、AI-2死亡、AI-3死亡');
    await expect.element(page.getByTestId('all-in-reveal')).not.toBeInTheDocument();
  });

  it('河牌后显示摊牌亮牌，输者同时开枪后出现胜利屏', async () => {
    vi.useFakeTimers();
    // AI 全部跟注，摊牌输者 roll=0 → 5/8 水位下全部死亡。
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    for (let stage = 0; stage < 4; stage += 1) {
      await page.getByRole('button', { name: '跟注' }).click();
      await flushTimers();
    }
    await flushTimers();

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

  it('其余人全弃牌且无人阵亡 → 仅剩玩家本手自动获胜，暂停等待开始下一手', async () => {
    vi.useFakeTimers();
    // Math.random=0.55 落在保守/均衡/激进三种性格的弃牌区间交集 [0.5, 0.65)，
    // 且 ≥1/8 死亡概率 → 3 名 AI 依次弃牌存活，仅剩人类活跃。
    vi.spyOn(Math, 'random').mockReturnValue(0.55);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '跟注' }).click();

    for (let fold = 0; fold < 3; fold += 1) {
      await flushTimers(); // 触发 0ms AI 思考 → 弃牌
      await vi.advanceTimersByTimeAsync(2500); // 2.5s 弃牌开枪 → 存活推进
    }

    await expect.element(page.getByTestId('hand-resolved-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('hand-resolution-fold-win')).toHaveTextContent(
      '其他人全弃牌，人类 本手自动获胜',
    );
    await expect.element(page.getByRole('button', { name: '开始下一手' })).toBeEnabled();
    // 全员无人出局，未判整局胜利（无胜利屏）
    expect(page.getByText('出局').elements()).toHaveLength(0);
    expect(page.getByTestId('win-screen').elements()).toHaveLength(0);

    await page.getByRole('button', { name: '开始下一手' }).click();
    await expect.element(page.getByText('当前阶段：翻牌前')).toBeInTheDocument();
  });

  it('弃牌开枪致死则标记出局并作废本手，暂停等待开始下一手', async () => {
    vi.useFakeTimers();
    // roll=0 → 1/8 水位下致死
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '弃牌' }).click();

    await vi.advanceTimersByTimeAsync(2500);

    await expect.element(page.getByTestId('fold-shoot-result')).toHaveTextContent('人类开枪：死亡');
    // 人类出局，暂停在 hand-resolved，行动按钮不可用
    expect(page.getByText('出局').elements()).toHaveLength(1);
    await expect.element(page.getByRole('button', { name: '开始下一手' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '跟注' })).toBeDisabled();

    await page.getByRole('button', { name: '开始下一手' }).click();

    // 进下一手 preflop，其余 3 名存活玩家重开 ante=1
    await expect.element(page.getByText('当前阶段：翻牌前')).toBeInTheDocument();
    expect(page.getByText('存活').elements()).toHaveLength(3);
  });

  it('摊牌后有存活者会暂停等待开始下一手', async () => {
    vi.useFakeTimers();
    // AI 全部跟注到摊牌，人类赢；输者开枪 roll=0.7 ≥ 5/8 全部存活 → ≥2 存活暂停。
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    for (let stage = 0; stage < 4; stage += 1) {
      await page.getByRole('button', { name: '跟注' }).click();
      await flushTimers();
    }
    await flushTimers();

    await expect.element(page.getByTestId('showdown-panel')).toBeInTheDocument();

    // 切换随机源使摊牌开枪掷骰全部存活
    random.mockReturnValue(0.7);
    await vi.advanceTimersByTimeAsync(2500);

    await expect.element(page.getByTestId('hand-resolved-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('hand-resolution-showdown')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '开始下一手' })).toBeEnabled();

    await page.getByRole('button', { name: '开始下一手' }).click();

    await expect.element(page.getByText('当前阶段：翻牌前')).toBeInTheDocument();
    expect(page.getByText('存活').elements()).toHaveLength(4);
  });

  it('胜利屏显示赢家信息并暂停，点击开始重置开新一局', async () => {
    vi.useFakeTimers();
    // AI 全部跟注，摊牌输者 roll=0 → 全部死亡。
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    for (let stage = 0; stage < 4; stage += 1) {
      await page.getByRole('button', { name: '跟注' }).click();
      await flushTimers();
    }
    await flushTimers();

    await expect.element(page.getByTestId('showdown-panel')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2500);

    await expect.element(page.getByTestId('win-screen')).toBeInTheDocument();
    await expect.element(page.getByText('人类 是最后一名存活玩家。')).toBeInTheDocument();

    await page.getByRole('button', { name: '开始' }).click();

    await expect.element(page.getByText('当前阶段：翻牌前')).toBeInTheDocument();
    await expect.element(page.getByText('当前行动者：人类')).toBeInTheDocument();
    expect(page.getByText('本手下注：1 颗子弹').elements()).toHaveLength(4);
    expect(page.getByText('存活').elements()).toHaveLength(4);
    expect(page.getByTestId('human-hole-card').elements()).toHaveLength(2);
    expect(page.getByTestId('ai-hole-card-hidden').elements()).toHaveLength(6);
  });

  it('开始游戏会洗牌，人类底牌不恒为 A♠ A♥', async () => {
    // 不 mock Math.random：bug 下 start-game 未传洗过的牌组，人类底牌恒为 A♠ A♥。
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();

    const humanCards = page
      .getByTestId('human-hole-card')
      .elements()
      .map((card) => card.textContent);
    expect(humanCards).toHaveLength(2);
    expect(humanCards).not.toEqual(['A♠', 'A♥']);
  });

  it('正常行动轮轮到 AI 时该 AI 座位出现 spinner，轮到人类时无 spinner', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    // 人类回合，无 AI 思考 spinner
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(0);

    await page.getByRole('button', { name: '跟注' }).click();
    await expect.element(page.getByText('AI-1 正在思考…')).toBeInTheDocument();
    // 仅当前行动的 AI 座位有 spinner
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(1);

    await flushTimers();
    await expect.element(page.getByText('当前行动者：人类')).toBeInTheDocument();
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(0);
  });

  it('All-in 等待阶段每个待响应 AI 座位显示 spinner，响应完后消失', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    delayAiDecisions(50);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '跟注' }).click();

    // 推进到 AI-1 完成全押并触发 All-in 等待（AI-2/AI-3 尚未响应）
    await vi.advanceTimersByTimeAsync(50);

    await expect.element(page.getByTestId('all-in-wait-panel')).toBeInTheDocument();
    // 待响应 AI 为 AI-2、AI-3，共 2 个 spinner
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(2);

    // 再推进让 AI-2/AI-3 响应完，spinner 应全部消失
    await vi.advanceTimersByTimeAsync(100);
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(0);
  });

  it('All-in 等待阶段某个 AI 弃牌响应后其 spinner 消失，其他 AI 仍转动', async () => {
    vi.useFakeTimers();
    // AI-1 快速全押触发等待；AI-2 较慢弃牌；AI-3 最慢全押，便于观察中间状态。
    mockAiActions([
      { action: 'all-in', delayMs: 50 },
      { action: 'fold', delayMs: 100 },
      { action: 'all-in', delayMs: 500 },
    ]);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByRole('button', { name: '跟注' }).click();

    // 推进到 AI-1 已全押、All-in 等待已触发，AI-2/AI-3 均在思考
    await vi.advanceTimersByTimeAsync(100);
    await expect.element(page.getByTestId('all-in-wait-panel')).toBeInTheDocument();
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(2);

    // 再推进让 AI-2 弃牌响应，其 spinner 消失；AI-3 仍在思考
    await vi.advanceTimersByTimeAsync(150);
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(1);

    // 再推进让 AI-3 全押，spinner 全部消失
    await vi.advanceTimersByTimeAsync(500);
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(0);
  });

  it('人类座位在任何状态下都不出现思考 spinner', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    delayAiDecisions(50);
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();
    // 人类回合无 spinner
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(0);

    await page.getByRole('button', { name: '跟注' }).click();
    // AI-1 行动轮有 spinner，但不是人类座位
    await expect.element(page.getByText('AI-1 正在思考…')).toBeInTheDocument();
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(1);

    // 推进到 AI-1 全押进入 All-in 等待，人类自己也待响应但无 spinner
    await vi.advanceTimersByTimeAsync(50);
    await expect.element(page.getByTestId('all-in-wait-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('all-in-countdown')).toBeInTheDocument();
    // 只有 AI-2、AI-3 两个 AI 待响应座位有 spinner
    expect(page.getByTestId('thinking-spinner').elements()).toHaveLength(2);
  });

  it('AI 性格标识不对玩家展示', async () => {
    // 性格仍影响 AI 决策（内部不变），仅 UI 不展示。
    render(Page);

    await page.getByRole('button', { name: '开始游戏' }).click();

    expect(page.getByTestId('ai-personality').elements()).toHaveLength(0);
  });
});
