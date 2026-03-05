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

module.exports = { getRank, getRankWithPosition };
