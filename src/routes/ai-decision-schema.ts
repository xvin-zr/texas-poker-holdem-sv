import type { ActionRecord, Card, DecisionInput, PlayerId, PublicPlayer, Stage } from '$lib/engine';
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

export type AnonymizedPlayerId = 'me' | 'seat-1' | 'seat-2' | 'seat-3';

export type AnonymizedPublicPlayer = {
  id: AnonymizedPlayerId;
  alive: boolean;
  folded: boolean;
  allIn: boolean;
  betThisHand: number;
};

export type AnonymizedActionRecord = {
  stage: ActionRecord['stage'];
  playerId: AnonymizedPlayerId;
  decision: ActionRecord['decision'];
};

export type AnonymizedDecisionInput = {
  stage: DecisionInput['stage'];
  myBetThisHand: number;
  myHoleCards: readonly [Readonly<Card>, Readonly<Card>];
  communityCards: readonly Readonly<Card>[];
  alivePlayers: AnonymizedPublicPlayer[];
  activePlayers: AnonymizedPublicPlayer[];
  actionHistory: AnonymizedActionRecord[];
  pendingAllIn: boolean;
};

type AnonymizeInput = {
  readonly stage: Stage;
  readonly myBetThisHand: number;
  readonly myHoleCards: readonly [Readonly<Card>, Readonly<Card>];
  readonly communityCards: readonly Readonly<Card>[];
  readonly alivePlayers: readonly Readonly<PublicPlayer>[];
  readonly activePlayers: readonly Readonly<PublicPlayer>[];
  readonly actionHistory: readonly Readonly<{
    stage: Stage;
    playerId: PlayerId;
    decision: { action: 'call' | 'fold' | 'all-in' };
  }>[];
  readonly pendingAllIn: boolean;
};

/**
 * 把 DecisionInput 投影为匿名席位视图：对手只留公开状态，id 映射为 seat-N，自己为 me。
 * 映射按固定枚举顺序 [human, ai-1, ai-2, ai-3] 排除 meId 后依次分配 seat-1/2/3。
 */
export function anonymizeForAiView(input: AnonymizeInput, meId: PlayerId): AnonymizedDecisionInput {
  const orderedIds: PlayerId[] = ['human', 'ai-1', 'ai-2', 'ai-3'];
  const seatIds = orderedIds.filter((id) => id !== meId);
  const idMap = new Map<PlayerId, AnonymizedPlayerId>([
    [meId, 'me'],
    ...seatIds.map((id, index): [PlayerId, AnonymizedPlayerId] => [
      id,
      `seat-${index + 1}` as AnonymizedPlayerId,
    ]),
  ]);

  const remapPlayer = (player: Readonly<PublicPlayer>): AnonymizedPublicPlayer => ({
    id: idMap.get(player.id) ?? 'me',
    alive: player.alive,
    folded: player.folded,
    allIn: player.allIn,
    betThisHand: player.betThisHand,
  });

  return {
    stage: input.stage,
    myBetThisHand: input.myBetThisHand,
    myHoleCards: input.myHoleCards,
    communityCards: input.communityCards,
    alivePlayers: input.alivePlayers.map(remapPlayer),
    activePlayers: input.activePlayers.map(remapPlayer),
    actionHistory: input.actionHistory.map((record) => ({
      stage: record.stage,
      playerId: idMap.get(record.playerId) ?? 'me',
      decision: record.decision,
    })),
    pendingAllIn: input.pendingAllIn,
  };
}

export function visibleGameMessage(input: AnonymizeInput, meId: PlayerId): string {
  return JSON.stringify(anonymizeForAiView(input, meId));
}
