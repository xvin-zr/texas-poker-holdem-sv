import { query } from '$app/server';
import type { Decision, DecisionInput, Personality } from '$lib/engine';
import { chat } from '@tanstack/ai';
import * as S from 'effect/Schema';

import { makeOpenrouterAdapter } from './model';

// ponytail: remote function 现为空骨架，实际 prompt 拼装与 structuredOutput 调用在 Slice 02 落地

/** 客户端 → remote function 输入（来自 PRD 原型） */
export type AiDecisionRequest = {
  input: DecisionInput;
  personality: Personality;
  legalActions: Decision['action'][];
};

const AiDecisionReqSchema = S.Struct({}).pipe(S.toStandardSchemaV1);

/** remote function → 客户端输出（来自 PRD 原型） */
export type AiDecisionResponse = { action: Decision['action'] };

export const decideAiActionRemote = query(AiDecisionReqSchema, async () => {
  const adapter = makeOpenrouterAdapter();
  // ponytail: 薄管道——拼 prompt + structuredOutput + 透传，不校验不兜底（校验与回退单点在客户端 decideForAi）

  const resp = await chat({
    adapter,
    systemPrompts: [{ content: 'todo' }],
    outputSchema: S.Struct({
      action: S.Literals(['call', 'fold', 'all-in']),
    }).pipe(S.toStandardSchemaV1),
  });

  return resp;
});
