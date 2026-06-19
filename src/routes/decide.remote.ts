import { query } from '$app/server';
import type { Decision, DecisionInput, Personality } from '$lib/engine';
import { makeOpenrouterAdapter } from '$lib/server/ai/model';
import { chat } from '@tanstack/ai';
import * as S from 'effect/Schema';

/** 客户端 → 远程函数输入（来自 PRD 原型） */
export type AiDecisionRequest = {
  input: DecisionInput;
  personality: Personality;
  legalActions: Decision['action'][];
};

const ActionSchema = S.Literals(['call', 'fold', 'all-in']);
const PersonalitySchema = S.Literals(['conservative', 'balanced', 'aggressive']);
const CardSchema = S.Struct({
  rank: S.Literals(['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']),
  suit: S.Literals(['♠', '♥', '♦', '♣']),
});
const PublicPlayerSchema = S.Struct({
  id: S.Literals(['human', 'ai-1', 'ai-2', 'ai-3']),
  name: S.String,
  isHuman: S.Boolean,
  personality: S.optionalKey(PersonalitySchema),
  alive: S.Boolean,
  folded: S.Boolean,
  allIn: S.Boolean,
  betThisHand: S.Number,
});
const DecisionInputSchema = S.Struct({
  stage: S.Literals(['preflop', 'flop', 'turn', 'river']),
  myBetThisHand: S.Number,
  myHoleCards: S.Tuple([CardSchema, CardSchema]),
  communityCards: S.Array(CardSchema),
  alivePlayers: S.Array(PublicPlayerSchema),
  activePlayers: S.Array(PublicPlayerSchema),
  actionHistory: S.Array(
    S.Struct({
      stage: S.Literals(['preflop', 'flop', 'turn', 'river']),
      playerId: S.Literals(['human', 'ai-1', 'ai-2', 'ai-3']),
      decision: S.Struct({ action: ActionSchema }),
    }),
  ),
  pendingAllIn: S.Boolean,
});
const AiDecisionReqSchema = S.Struct({
  input: DecisionInputSchema,
  personality: PersonalitySchema,
  legalActions: S.Array(ActionSchema),
}).pipe(S.toStandardSchemaV1);

/** 远程函数 → 客户端输出（来自 PRD 原型） */
export type AiDecisionResponse = { action: Decision['action'] };

export const decideAiActionRemote = query(AiDecisionReqSchema, async (request) => {
  const response = await chat({
    adapter: makeOpenrouterAdapter(),
    systemPrompts: [personalityPrompt(request.personality)],
    messages: [{ role: 'user', content: visibleGameMessage(request.input) }],
    outputSchema: S.Struct({
      action: S.Literals(request.legalActions),
    }).pipe(S.toStandardSchemaV1),
  });

  // 薄管道：不在远程端校验合法性、不重试、不兜底，回退单点留给 decideForAi。
  return response;
});

function personalityPrompt(personality: Personality) {
  const style: Record<Personality, string> = {
    conservative: '你是保守型 AI：优先降低开枪风险，牌势弱或风险过高时倾向弃牌。',
    balanced: '你是均衡型 AI：在牌力、阶段信息和死亡风险之间折中。',
    aggressive: '你是激进型 AI：更愿意跟注或全押施压，但仍必须只选择允许动作。',
  };
  return `${style[personality]} 你正在玩德州扑克俄轮版。只返回 JSON，不要解释。`;
}

function visibleGameMessage(input: {
  stage: DecisionInput['stage'];
  myBetThisHand: number;
  myHoleCards: unknown;
  communityCards: unknown;
  alivePlayers: unknown;
  activePlayers: unknown;
  actionHistory: unknown;
  pendingAllIn: boolean;
}) {
  return JSON.stringify({
    stage: input.stage,
    myBetThisHand: input.myBetThisHand,
    myHoleCards: input.myHoleCards,
    communityCards: input.communityCards,
    alivePlayers: input.alivePlayers,
    activePlayers: input.activePlayers,
    actionHistory: input.actionHistory,
    pendingAllIn: input.pendingAllIn,
  });
}
