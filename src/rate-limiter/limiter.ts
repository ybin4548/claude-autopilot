import type { AutopilotConfig, AutopilotState } from '../types.js';
import { saveState } from '../state/state.js';

export type HealthCheckFn = () => Promise<boolean>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForRateLimit(
  state: AutopilotState,
  config: Pick<AutopilotConfig, 'rateLimit'>,
  stateDir: string,
  healthCheck: HealthCheckFn,
): Promise<void> {
  state.rateLimited = true;
  await saveState(state, stateDir);

  const intervalMs = config.rateLimit.healthCheckInterval * 1000;

  while (true) {
    await sleep(intervalMs);

    state.lastHealthCheck = new Date().toISOString();
    const healthy = await healthCheck();

    if (healthy) {
      state.rateLimited = false;
      state.lastHealthCheck = new Date().toISOString();
      await saveState(state, stateDir);
      return;
    }

    await saveState(state, stateDir);
  }
}

export function markRateLimited(state: AutopilotState): AutopilotState {
  return { ...state, rateLimited: true };
}

export function isRateLimited(state: AutopilotState): boolean {
  return state.rateLimited;
}
