/**
 * Get rank based on rating only (legacy function)
 * @param {number} rating - Player's rating
 * @returns {string} Rank name
 */
function getRank(rating) {
  const r = Math.max(0, Number(rating) || 0);

  if (r >= 450) return "legendary";
  if (r >= 350) return "diamond";
  if (r >= 250) return "platinum";
  if (r >= 150) return "gold";
  if (r >= 75) return "silver";
  return "bronze";
}

/**
 * Get rank based on rating AND leaderboard position
 * Special ranks: Grandmaster (#1), Master (top 10 + rating >= 550)
 * @param {number} rating - Player's rating
 * @param {number} position - Leaderboard position (1-based)
 * @returns {string} Rank name
 */
function getRankWithPosition(rating, position) {
  const r = Math.max(0, Number(rating) || 0);
  const pos = Number(position) || 0;

  // Special rank overrides
  if (pos === 1) return "grandmaster";
  if (pos <= 10 && r >= 550) return "master";

  // Rating-based ranks
  if (r >= 450) return "legendary";
  if (r >= 350) return "diamond";
  if (r >= 250) return "platinum";
  if (r >= 150) return "gold";
  if (r >= 75) return "silver";
  return "bronze";
}

/**
 * Get Time Trial rank based on survival time (milliseconds) and leaderboard placement
 * @param {number} ms - Survival time in milliseconds
 * @param {number|null} position - Optional leaderboard position (1-based)
 * @returns {string} Rank key ("bronze"|"silver"|"gold"|"platinum"|"diamond"|"legendary"|"master"|"grandmaster")
 */
function getTimeTrialRank(ms, position = null) {
  const time = Math.max(0, Number(ms) || 0);
  const pos = Number(position) || 0;

  // Apex survivor for #1 with at least 60s
  if (pos === 1 && time >= 60000) return "grandmaster";
  // Champions for top 3 with at least 60s
  if (pos > 1 && pos <= 3 && time >= 60000) return "master";

  // Survival milestone tiers
  if (time >= 180000) return "legendary"; // 3:00+ (Mythic survival)
  if (time >= 120000) return "diamond";   // 2:00 - 2:59 (Survived laser round)
  if (time >= 90000) return "platinum";   // 1:30 - 1:59 (Mastered second phase)
  if (time >= 60000) return "gold";       // 1:00 - 1:29 (Survived through boss phase)
  if (time >= 30000) return "silver";     // 0:30 - 0:59 (Escaped initial assault)
  return "bronze";                        // 0:00 - 0:29 (Initiate)
}

/**
 * Get human-readable title for Time Trial ranks
 * @param {string} rank 
 * @returns {string}
 */
function getTimeTrialTitle(rank) {
  const titles = {
    grandmaster: "APEX SURVIVOR",
    master: "CHAMPION SURVIVOR",
    legendary: "IMMORTAL SURVIVOR",
    diamond: "DIAMOND SURVIVOR",
    platinum: "ELITE SURVIVOR",
    gold: "VETERAN SURVIVOR",
    silver: "ADEPT SURVIVOR",
    bronze: "INITIATE SURVIVOR",
  };
  return titles[rank] || "SURVIVOR";
}

module.exports = {
  getRank,
  getRankWithPosition,
  getTimeTrialRank,
  getTimeTrialTitle,
};
