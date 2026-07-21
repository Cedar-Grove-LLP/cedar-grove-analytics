// Pure projected-earnings math for the Projected Earnings admin page. Stored
// client rates determine rank; take-home rates determine FTE payout, PTE rates
// stay flat, Q2/Q4 boundaries can bump rank, and partners share predicted profit.

export const MAX_RANK = 19;

export const MONTH_INDEX = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

export const isColin = (name) => /colin\s+van\s+loon/i.test(name || '');

const PARTNER_SHARES = [
  { test: (name) => /sam\s+mcclure/i.test(name || ''), pct: 0.95 },
  { test: (name) => /colin\s+van\s+loon/i.test(name || ''), pct: 0.05 },
];

export const partnerSharePct = (name) => PARTNER_SHARES.find((partner) => partner.test(name))?.pct || 0;

export const takeHomeField = (name) => (isColin(name) ? 'colinRate' : 'attorneyRate');

export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

export const findLatestRate = (ratesByMonth) => {
  if (!ratesByMonth) return null;
  const keys = Object.keys(ratesByMonth).sort();
  if (keys.length === 0) return null;
  const last = keys[keys.length - 1];
  return {
    rate: ratesByMonth[last]?.rate || 0,
    monthKey: last,
  };
};

export const findRankForRate = (levels, rate, field) => {
  if (!rate || !Array.isArray(levels)) return -1;
  return levels.findIndex((level) => Number(level[field]) === Number(rate));
};

export const predictedRankForMonth = (startRank, currentMonth, month) => {
  let rank = startRank;
  if (currentMonth < 4 && month >= 4) rank += 1;
  if (currentMonth < 10 && month >= 10) rank += 1;
  return Math.min(rank, MAX_RANK);
};

export const predictedAnnualProfit = (monthlyMetrics, currentMonth, currentYear) => {
  const completedMonths = (monthlyMetrics || []).filter((entry) => {
    const month = MONTH_INDEX[entry.month];
    return Number(entry.year) === currentYear
      && month
      && month < currentMonth
      && Number.isFinite(entry.firmProfit);
  });

  return completedMonths.length
    ? (completedMonths.reduce((sum, entry) => sum + Number(entry.firmProfit), 0) / completedMonths.length) * 12
    : 0;
};

export const buildProjectedRow = ({
  user,
  levels,
  allBillableEntries,
  allRates,
  allTargets,
  today,
  currentMonth,
  currentYear,
  promoted,
  annualProfit,
  getEntryDate,
}) => {
  const name = user.name || user.id;
  const payField = takeHomeField(name);
  const isPte = (user.employmentType || 'FTE') === 'PTE';

  let ytdEarnings = 0;
  let ytdHours = 0;
  const monthlyActualHours = {};
  (allBillableEntries || []).forEach((entry) => {
    if (entry.userId !== user.id) return;
    if (entry.year !== currentYear) return;
    const date = getEntryDate(entry);
    if (!date || isNaN(date.getTime())) return;
    if (date > today) return;
    const month = date.getMonth() + 1;
    ytdEarnings += entry.earnings || 0;
    ytdHours += entry.billableHours || 0;
    monthlyActualHours[month] = (monthlyActualHours[month] || 0) + (entry.billableHours || 0);
  });

  const latest = findLatestRate(allRates?.[name]);
  const startRank = latest ? findRankForRate(levels, latest.rate, 'clientRate') : -1;
  const hasRankMatch = isPte ? true : startRank !== -1;
  const currentRate = latest?.rate || 0;

  let projectedEarnings = 0;
  let projectedHours = 0;
  let endRank = startRank;

  for (let month = currentMonth; month <= 12; month += 1) {
    const targetHours = allTargets?.[name]?.[monthKey(currentYear, month)]?.billableHours || 0;
    if (!targetHours) continue;

    let monthRate;
    if (isPte) {
      monthRate = currentRate;
    } else if (hasRankMatch) {
      const rank = promoted ? predictedRankForMonth(startRank, currentMonth, month) : startRank;
      endRank = Math.max(endRank, rank);
      monthRate = Number(levels[rank]?.[payField]) || Number(levels[rank]?.attorneyRate) || 0;
    } else {
      monthRate = 0;
    }

    let hoursToProject = targetHours;
    if (month === currentMonth) {
      hoursToProject = Math.max(0, targetHours - (monthlyActualHours[month] || 0));
    }

    projectedEarnings += hoursToProject * monthRate;
    projectedHours += hoursToProject;
  }

  const startLevel = (!isPte && hasRankMatch) ? levels[startRank] : null;
  const endLevel = (!isPte && hasRankMatch) ? levels[endRank] : null;
  const sharePct = partnerSharePct(name);
  const isPartner = sharePct > 0;
  const profitShare = annualProfit * sharePct;

  return {
    userId: user.id,
    name,
    isColin: isColin(name),
    isPte,
    promoted,
    canPromote: !isPte && hasRankMatch,
    currentRate,
    hasRankMatch,
    startLevelLabel: startLevel ? `${startLevel.level}/${startLevel.tier}` : '—',
    endLevelLabel: endLevel ? `${endLevel.level}/${endLevel.tier}` : '—',
    ytdEarnings,
    ytdHours,
    projectedEarnings,
    projectedHours,
    isPartner,
    profitShare,
    totalProjectedEarnings: ytdEarnings + projectedEarnings + profitShare,
  };
};

export const sumTotals = (list) =>
  list.reduce(
    (totals, row) => ({
      ytdEarnings: totals.ytdEarnings + row.ytdEarnings,
      ytdHours: totals.ytdHours + row.ytdHours,
      projectedHours: totals.projectedHours + row.projectedHours,
      projectedEarnings: totals.projectedEarnings + row.projectedEarnings,
      profitShare: totals.profitShare + row.profitShare,
      totalProjectedEarnings: totals.totalProjectedEarnings + row.totalProjectedEarnings,
    }),
    {
      ytdEarnings: 0,
      ytdHours: 0,
      projectedHours: 0,
      projectedEarnings: 0,
      profitShare: 0,
      totalProjectedEarnings: 0,
    }
  );
