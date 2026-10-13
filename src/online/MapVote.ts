/**
 * MAP VOTE: every racer votes for the visual map before the race; if the votes
 * differ, one of them is drawn at random.
 *
 * The draw is deterministic from the race id and the racers' ids, so every
 * client that holds the same votes reaches the same map without a server round
 * trip. The map is purely visual (it is not part of the course fingerprint), so
 * a vote that goes missing can at worst show one racer a different backdrop.
 */

/** 32-bit FNV-1a, enough to spread a race id over a handful of ballots. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface MapDraw {
  key: string;
  /** Distinct maps that were voted for. */
  options: string[];
  /** True when the votes differed and the pick was a draw. */
  drawn: boolean;
}

/**
 * Picks the race's map. Each racer's ballot counts once (a racer who has not
 * voted counts as `fallback`); a ballot is chosen from the racers sorted by id,
 * using the race id as the seed.
 */
export function drawRaceMap(
  raceId: string,
  votes: ReadonlyMap<string, string>,
  racerIds: readonly string[],
  fallback: string
): MapDraw {
  const ids = [...racerIds].sort();
  if (ids.length === 0) return { key: fallback, options: [fallback], drawn: false };
  const ballots = ids.map((id) => votes.get(id) ?? fallback);
  const options = [...new Set(ballots)];
  const key = ballots[hashString(raceId) % ballots.length];
  return { key, options, drawn: options.length > 1 };
}
