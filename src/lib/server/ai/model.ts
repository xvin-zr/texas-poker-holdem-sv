import { env } from '$env/dynamic/private';
import { createOpenRouterText } from '@tanstack/ai-openrouter';

export function makeOpenrouterAdapter() {
  const adapter = createOpenRouterText('google/gemma-4-31b-it:free', env.OPENROUTER_API_KEY!);

  return adapter;
}
