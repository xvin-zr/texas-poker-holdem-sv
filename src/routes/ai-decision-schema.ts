import type { DecisionInput } from '$lib/engine';
import * as S from 'effect/Schema';

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
  personality: S.optional(PersonalitySchema),
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

const AiDecisionReqEffectSchema = S.Struct({
  input: DecisionInputSchema,
  personality: PersonalitySchema,
  legalActions: S.Array(ActionSchema),
});

export const AiDecisionReqSchema = S.toStandardSchemaV1(AiDecisionReqEffectSchema);

type PromptPlayer = { readonly personality?: unknown; readonly [key: string]: unknown };

export function visibleGameMessage(input: {
  readonly stage: DecisionInput['stage'];
  readonly myBetThisHand: number;
  readonly myHoleCards: unknown;
  readonly communityCards: unknown;
  readonly alivePlayers: ReadonlyArray<PromptPlayer>;
  readonly activePlayers: ReadonlyArray<PromptPlayer>;
  readonly actionHistory: unknown;
  readonly pendingAllIn: boolean;
}) {
  return JSON.stringify({
    stage: input.stage,
    myBetThisHand: input.myBetThisHand,
    myHoleCards: input.myHoleCards,
    communityCards: input.communityCards,
    alivePlayers: hidePlayerPersonalities(input.alivePlayers),
    activePlayers: hidePlayerPersonalities(input.activePlayers),
    actionHistory: input.actionHistory,
    pendingAllIn: input.pendingAllIn,
  });
}

function hidePlayerPersonalities(players: ReadonlyArray<PromptPlayer>) {
  return players.map(({ personality: _personality, ...player }) => player);
}
