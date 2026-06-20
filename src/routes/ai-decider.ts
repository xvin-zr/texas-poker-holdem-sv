import type { AiDecider, Decision, Personality } from '$lib/engine';
import { deriveLegalActions } from '$lib/engine';

import {
  decideAiActionRemote,
  type AiDecisionRequest,
  type AiDecisionResponse,
} from './decide.remote';

export const OPENROUTER_DECISION_TIMEOUT_MS = 30_000;

type AiDecisionTransport = (request: AiDecisionRequest) => Promise<AiDecisionResponse>;

export function createOpenRouterAiDecider(
  personality: Personality,
  transport: AiDecisionTransport = decideAiActionRemote,
  timeoutMs = OPENROUTER_DECISION_TIMEOUT_MS,
): AiDecider {
  return {
    decide: (input) => {
      const request = { input, personality, legalActions: deriveLegalActions(input) };
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('AI 决策超时')), timeoutMs);
      });

      return Promise.race([transport(request), timeoutPromise]).finally(() => {
        if (timeout) clearTimeout(timeout);
      }) as Promise<Decision>;
    },
  };
}
