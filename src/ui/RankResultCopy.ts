import { RunResults } from '../player/PlayerStats';

export function getUnrankedReason(results: RunResults, isOvertime: boolean): string {
  if (results.rankFailureReason === 'BRONZE_TIME_MISSED') {
    return `// BRONZE TARGET MISSED // +${(results.bronzeTimeOverage ?? 0).toFixed(1)}s`;
  }
  if (results.rankFailureReason === 'UNFINISHED') {
    return '// INVALID ROUTE // FINISH NOT REGISTERED';
  }
  if (results.rankFailureReason === 'INVALID_RUN') {
    return '// INVALID RUN // TIMING DATA ERROR';
  }
  return isOvertime
    ? '// BRONZE TARGET MISSED // OVERTIME'
    : '// INVALID RUN // QUALIFICATION ERROR';
}
