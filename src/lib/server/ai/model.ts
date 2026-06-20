import { env } from '$env/dynamic/private';
import { createOpenRouterText } from '@tanstack/ai-openrouter';

export function makeOpenrouterAdapter() {
  const adapter = createOpenRouterText(
    'liquid/lfm-2.5-1.2b-thinking:free',
    env.OPENROUTER_API_KEY!,
  );

  return adapter;
}
