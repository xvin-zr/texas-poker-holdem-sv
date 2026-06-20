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
    systemPrompts: [pokerSystemPrompt],
    messages: [{ role: 'user', content: visibleGameMessage(request.input, meId) }],
    outputSchema: S.Struct({
      action: S.Literals(request.legalActions),
    }).pipe(S.toStandardJSONSchemaV1),
    debug: true,
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

const pokerSystemPrompt = `You are an experienced Texas Hold'em poker player.

Game basics:
- This is Texas Hold'em mixed with Russian roulette.
- Build the strongest five-card hand from your two hole cards and the community cards.
- Bullets are not a limited resource; betThisHand is the current death-risk meter for this hand.
- Shooting death chance is based on betThisHand / 8, capped at 95%.
- Use hand strength, draw odds, board texture, opponent actions, and death risk to choose a legal action.
- Do not treat folding as the safe default: folding fires the gun immediately.

Action meanings:
- call: add 1 bullet to betThisHand and stay in the hand. Use it when the extra death risk is worth your hand equity or draw.
- fold: leave this hand, then shoot yourself with death risk based on your current betThisHand. Choose fold only with weak equity, poor draws, or when calling/all-in is clearly worse than immediate roulette.
- all-in: set betThisHand to 8 and force the all-in showdown flow; your shooting death chance is 95%. Use it with strong winning chances, strong pressure, or true desperation.

Return only JSON matching the requested schema. Do not explain.`;
