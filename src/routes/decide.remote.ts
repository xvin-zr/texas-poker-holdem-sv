import { query } from '$app/server';
import type { Decision, DecisionInput, Personality, PlayerId } from '$lib/engine';
import { makeOpenrouterAdapter } from '$lib/server/ai/model';
import { chat } from '@tanstack/ai';
import * as S from 'effect/Schema';

import { AiDecisionReqSchema, visibleGameMessage } from './ai-decision-schema';

/** 客户端 → 远程函数输入（来自 PRD 原型） */
export type AiDecisionRequest = {
  input: DecisionInput;
  personality: Personality;
  legalActions: Decision['action'][];
};

/** 远程函数 → 客户端输出（来自 PRD 原型） */
export type AiDecisionResponse = { action: Decision['action'] };

export const decideAiActionRemote = query(AiDecisionReqSchema, async (request) => {
  const meId = deriveMeId(request.input, request.personality);
  const response = await chat({
    adapter: makeOpenrouterAdapter(),
    systemPrompts: [personalityPrompt(request.personality)],
    messages: [{ role: 'user', content: visibleGameMessage(request.input, meId) }],
    outputSchema: S.Struct({
      action: S.Literals(request.legalActions),
    }).pipe(S.toStandardJSONSchemaV1),
  });

  // 薄管道：不在远程端校验合法性、不重试、不兜底，回退单点留给 decideForAi。
  return response;
});

function deriveMeId(
  input: {
    readonly alivePlayers: readonly {
      readonly id: PlayerId;
      readonly isHuman: boolean;
      readonly personality?: Personality;
    }[];
  },
  personality: Personality,
): PlayerId {
  // 每局三种性格唯一分配给三个 AI，请求决策的 AI 必在 alivePlayers 中。
  const me = input.alivePlayers.find(
    (player) => !player.isHuman && player.personality === personality,
  );
  return me!.id;
}

function personalityPrompt(personality: Personality) {
  const style: Record<Personality, string> = {
    conservative: '你是保守型 AI：优先降低开枪风险，牌势弱或风险过高时倾向弃牌。',
    balanced: '你是均衡型 AI：在牌力、阶段信息和死亡风险之间折中。',
    aggressive: '你是激进型 AI：更愿意跟注或全押施压，但仍必须只选择允许动作。',
  };
  return `${style[personality]} 你正在玩德州扑克俄轮版。只返回 JSON，不要解释。`;
}
