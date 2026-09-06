const PAYMENT_METHODS = new Set(['CREDIT_CARD', 'CASH', 'DEBIT_CARD', 'DIGITAL_WALLET', 'BANK_TRANSFER', 'OTHER']);
const EXPENSE_STATUSES = new Set(['PLANNED', 'COMMITTED', 'PAID']);
const ESSENTIAL_CATEGORIES = new Set(['LODGING', 'TRANSPORT', 'FOOD', 'MEDICAL', 'COMMUNICATION', 'OTHER_ESSENTIAL']);

export function budgetIntelligenceCapabilities() {
  return {
    version: '1.0',
    purpose: 'Plan and monitor the trip budget across card and cash while preserving access to local currency for emergencies and cash-only situations.',
    paymentMethods: [...PAYMENT_METHODS],
    principles: [
      'The user defines how much they intend to spend; card limit is not treated as trip budget.',
      'Track total budget, card allocation, cash allocation, committed spend, paid spend and remaining flexible budget separately.',
      'When travelling outside the home currency, local cash readiness is a first-class planning check.',
      'Never invent FX rates, bank fees, card acceptance, ATM availability or merchant payment methods.',
      'A cash-only requirement is only treated as such when verified or explicitly informed by the user.',
      'Emergency cash is a reserve, not an invitation to spend more.',
      'Budget recommendations never authorize purchases or itinerary changes without user approval.'
    ],
    localCashPolicy: {
      shouldBeConsideredWhenDestinationCurrencyDiffers: true,
      emergencyReserveSupported: true,
      cashOnlyMerchantCoverageSupported: true,
      verifiedFxRequiredForAutomaticConversion: true
    }
  };
}

export function normalizeTripBudget(input = {}) {
  const homeCurrency = safeCurrency(input.homeCurrency || input.currency || 'BRL');
  const destinationCurrency = safeCurrency(input.destinationCurrency || input.localCurrency);
  const totalBudget = optionalMoney(input.totalBudget ?? input.totalLimit);
  const cardBudget = optionalMoney(input.cardBudget ?? input.creditCardBudget);
  const cashBudget = optionalMoney(input.cashBudget ?? input.cashPlanned);
  const localCashOnHand = optionalMoney(input.localCashOnHand);
  const emergencyCashTargetLocal = optionalMoney(input.emergencyCashTargetLocal);
  const emergencyDays = clampInteger(input.emergencyDays, 0, 7, 1);
  const essentialDailyBudgetLocal = optionalMoney(input.essentialDailyBudgetLocal);
  const categoryTargets = normalizeCategoryTargets(input.categoryTargets);
  const fx = normalizeFx(input.fxRate || input.fx);

  return {
    homeCurrency,
    destinationCurrency,
    totalBudget,
    cardBudget,
    cashBudget,
    localCashOnHand,
    emergencyCashTargetLocal,
    emergencyDays,
    essentialDailyBudgetLocal,
    categoryTargets,
    fx,
    card: {
      foreignTransactionFeePercent: optionalPercent(input.card?.foreignTransactionFeePercent ?? input.foreignTransactionFeePercent),
      preferredNetwork: safeString(input.card?.preferredNetwork, 40),
      internationalUseEnabled: input.card?.internationalUseEnabled === true ? true : input.card?.internationalUseEnabled === false ? false : null
    },
    preferences: {
      avoidCash: input.preferences?.avoidCash === true,
      preferCard: input.preferences?.preferCard !== false,
      keepEmergencyCashUntouched: input.preferences?.keepEmergencyCashUntouched !== false
    }
  };
}

export function buildBudgetPlan(input = {}) {
  const budget = normalizeTripBudget(input.budget || input);
  const expenses = normalizeExpenses(input.expenses || []);
  const paymentRequirements = normalizePaymentRequirements(input.paymentRequirements || input.merchantRequirements || []);
  const researchNeeds = new Set();
  const warnings = [];
  const actions = [];

  if (budget.totalBudget === null) researchNeeds.add('TOTAL_TRIP_BUDGET');
  if (budget.cardBudget === null) researchNeeds.add('CARD_SPEND_BUDGET');
  if (budget.cashBudget === null) researchNeeds.add('CASH_SPEND_BUDGET');

  const allocated = sumKnown([budget.cardBudget, budget.cashBudget]);
  const allocationKnown = budget.cardBudget !== null && budget.cashBudget !== null;
  const unallocated = budget.totalBudget !== null && allocationKnown ? money(budget.totalBudget - allocated) : null;
  if (unallocated !== null && unallocated < 0) warnings.push('PAYMENT_ALLOCATIONS_EXCEED_TOTAL_BUDGET');

  const totals = summarizeExpenses(expenses, budget.homeCurrency, budget.destinationCurrency, budget.fx, researchNeeds);
  const committedOrPaidHome = money(totals.home.committed + totals.home.paid);
  const remainingTotalHome = budget.totalBudget !== null ? money(budget.totalBudget - committedOrPaidHome) : null;
  if (remainingTotalHome !== null && remainingTotalHome < 0) warnings.push('TOTAL_BUDGET_EXCEEDED');

  const cardUsedHome = money(expenses
    .filter((expense) => expense.paymentMethod === 'CREDIT_CARD' && ['COMMITTED', 'PAID'].includes(expense.status))
    .reduce((sum, expense) => sum + convertExpenseToHome(expense, budget, researchNeeds), 0));
  const cashUsedHome = money(expenses
    .filter((expense) => expense.paymentMethod === 'CASH' && ['COMMITTED', 'PAID'].includes(expense.status))
    .reduce((sum, expense) => sum + convertExpenseToHome(expense, budget, researchNeeds), 0));

  const cardRemainingHome = budget.cardBudget !== null ? money(budget.cardBudget - cardUsedHome) : null;
  const cashRemainingHome = budget.cashBudget !== null ? money(budget.cashBudget - cashUsedHome) : null;
  if (cardRemainingHome !== null && cardRemainingHome < 0) warnings.push('CARD_SPEND_BUDGET_EXCEEDED');
  if (cashRemainingHome !== null && cashRemainingHome < 0) warnings.push('CASH_SPEND_BUDGET_EXCEEDED');

  const localCash = assessLocalCashReadiness({ budget, paymentRequirements, researchNeeds, warnings, actions });
  const paymentReadiness = assessPaymentReadiness({ budget, paymentRequirements, expenses });
  paymentReadiness.researchNeeds.forEach((item) => researchNeeds.add(item));
  paymentReadiness.warnings.forEach((item) => warnings.push(item));
  paymentReadiness.actions.forEach((item) => actions.push(item));

  return {
    version: '1.0',
    status: warnings.some((item) => item.includes('EXCEEDED') || item.includes('INSUFFICIENT')) ? 'ACTION_NEEDED' : researchNeeds.size ? 'NEEDS_INPUT_OR_RESEARCH' : 'READY_FOR_REVIEW',
    budget,
    allocation: {
      totalHome: budget.totalBudget,
      cardHome: budget.cardBudget,
      cashHome: budget.cashBudget,
      unallocatedHome: unallocated
    },
    spending: {
      totals,
      committedOrPaidHome,
      remainingTotalHome,
      cardUsedHome,
      cardRemainingHome,
      cashUsedHome,
      cashRemainingHome
    },
    localCash,
    paymentReadiness,
    categoryStatus: buildCategoryStatus(budget.categoryTargets, expenses, budget, researchNeeds),
    researchNeeds: [...researchNeeds],
    warnings: unique(warnings),
    actions: unique(actions),
    approval: {
      purchasesRequireUserApproval: true,
      itineraryChangesRequireUserApproval: true,
      automaticSpendingAllowed: false
    }
  };
}

export function assessPaymentReadiness(input = {}) {
  const budget = input.budget?.homeCurrency ? input.budget : normalizeTripBudget(input.budget || input);
  const requirements = normalizePaymentRequirements(input.paymentRequirements || input.merchantRequirements || []);
  const warnings = [];
  const researchNeeds = [];
  const actions = [];

  for (const requirement of requirements) {
    if (!requirement.acceptedMethods.length) {
      researchNeeds.push(`PAYMENT_METHOD_ACCEPTANCE:${requirement.id}`);
      continue;
    }
    if (requirement.required && requirement.acceptedMethods.length === 1 && requirement.acceptedMethods[0] === 'CASH') {
      if (!requirement.amount || !requirement.currency) {
        researchNeeds.push(`CASH_REQUIREMENT_AMOUNT:${requirement.id}`);
        continue;
      }
      if (budget.destinationCurrency && requirement.currency === budget.destinationCurrency && budget.localCashOnHand !== null && budget.localCashOnHand < requirement.amount) {
        warnings.push(`INSUFFICIENT_LOCAL_CASH_FOR_REQUIRED_ITEM:${requirement.id}`);
        actions.push(`ACQUIRE_LOCAL_CASH_FOR:${requirement.id}`);
      }
    }
    if (requirement.required && requirement.acceptedMethods.includes('CREDIT_CARD') && budget.card.internationalUseEnabled === false) {
      warnings.push(`CARD_NOT_READY_FOR_INTERNATIONAL_USE:${requirement.id}`);
      actions.push('REVIEW_CARD_INTERNATIONAL_USE');
    }
  }

  return {
    ready: warnings.length === 0 && researchNeeds.length === 0,
    requirements,
    warnings: unique(warnings),
    researchNeeds: unique(researchNeeds),
    actions: unique(actions)
  };
}

function assessLocalCashReadiness({ budget, paymentRequirements, researchNeeds, warnings, actions }) {
  const international = Boolean(budget.destinationCurrency && budget.destinationCurrency !== budget.homeCurrency);
  const verifiedCashOnlyTotal = paymentRequirements
    .filter((item) => item.required && item.acceptedMethods.length === 1 && item.acceptedMethods[0] === 'CASH' && item.currency === budget.destinationCurrency && item.amount !== null)
    .reduce((sum, item) => sum + item.amount, 0);

  const emergencyFloor = budget.emergencyCashTargetLocal !== null
    ? budget.emergencyCashTargetLocal
    : budget.essentialDailyBudgetLocal !== null
      ? money(budget.essentialDailyBudgetLocal * budget.emergencyDays)
      : null;

  const requiredLocalCashTarget = emergencyFloor !== null ? money(emergencyFloor + verifiedCashOnlyTotal) : verifiedCashOnlyTotal > 0 ? money(verifiedCashOnlyTotal) : null;
  const onHand = budget.localCashOnHand;
  const shortfall = requiredLocalCashTarget !== null && onHand !== null ? money(Math.max(0, requiredLocalCashTarget - onHand)) : null;

  if (international && onHand === null) researchNeeds.add('LOCAL_CASH_ON_HAND');
  if (international && emergencyFloor === null) researchNeeds.add('EMERGENCY_LOCAL_CASH_TARGET');
  if (international && onHand === 0) {
    warnings.push('NO_LOCAL_CURRENCY_ON_HAND');
    actions.push('CONSIDER_ACQUIRING_LOCAL_CURRENCY_FOR_EMERGENCIES');
  }
  if (shortfall !== null && shortfall > 0) {
    warnings.push('LOCAL_CASH_RESERVE_INSUFFICIENT');
    actions.push('TOP_UP_LOCAL_CASH_RESERVE');
  }
  if (international && budget.fx === null && budget.cashBudget !== null) researchNeeds.add('VERIFIED_FX_RATE_FOR_LOCAL_CASH_CONVERSION');

  return {
    international,
    currency: budget.destinationCurrency,
    onHand,
    emergencyFloor,
    verifiedCashOnlyTotal: money(verifiedCashOnlyTotal),
    requiredLocalCashTarget,
    shortfall,
    reservePolicy: budget.emergencyCashTargetLocal !== null ? 'USER_DEFINED' : budget.essentialDailyBudgetLocal !== null ? 'ESSENTIAL_DAILY_BUDGET_X_EMERGENCY_DAYS' : 'NEEDS_USER_OR_VERIFIED_INPUT',
    note: 'Local cash covers resilience and verified cash-only needs; it is not added on top of the trip budget as extra discretionary spending.'
  };
}

function summarizeExpenses(expenses, homeCurrency, destinationCurrency, fx, researchNeeds) {
  const home = { planned: 0, committed: 0, paid: 0 };
  const local = { planned: 0, committed: 0, paid: 0 };
  for (const expense of expenses) {
    const key = expense.status.toLowerCase();
    if (expense.currency === homeCurrency) home[key] += expense.amount;
    else if (expense.currency === destinationCurrency) {
      local[key] += expense.amount;
      if (fx && fx.from === destinationCurrency && fx.to === homeCurrency) home[key] += expense.amount * fx.rate;
      else if (fx && fx.from === homeCurrency && fx.to === destinationCurrency) home[key] += expense.amount / fx.rate;
      else researchNeeds.add(`FX_RATE:${expense.currency}>${homeCurrency}`);
    } else {
      researchNeeds.add(`FX_RATE:${expense.currency}>${homeCurrency}`);
    }
  }
  for (const bucket of [home, local]) {
    bucket.planned = money(bucket.planned);
    bucket.committed = money(bucket.committed);
    bucket.paid = money(bucket.paid);
  }
  return { homeCurrency, destinationCurrency, home, local };
}

function convertExpenseToHome(expense, budget, researchNeeds) {
  if (expense.currency === budget.homeCurrency) return expense.amount;
  const fx = budget.fx;
  if (fx && fx.from === expense.currency && fx.to === budget.homeCurrency) return expense.amount * fx.rate;
  if (fx && fx.from === budget.homeCurrency && fx.to === expense.currency) return expense.amount / fx.rate;
  researchNeeds.add(`FX_RATE:${expense.currency}>${budget.homeCurrency}`);
  return 0;
}

function buildCategoryStatus(targets, expenses, budget, researchNeeds) {
  return Object.entries(targets).map(([category, target]) => {
    const spent = money(expenses
      .filter((expense) => expense.category === category && ['COMMITTED', 'PAID'].includes(expense.status))
      .reduce((sum, expense) => sum + convertExpenseToHome(expense, budget, researchNeeds), 0));
    return {
      category,
      targetHome: target,
      spentHome: spent,
      remainingHome: money(target - spent),
      exceeded: spent > target
    };
  });
}

function normalizeExpenses(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 5000).map((item, index) => ({
    id: safeString(item.id, 160) || `expense-${index + 1}`,
    title: safeString(item.title, 220) || 'Despesa',
    amount: optionalMoney(item.amount) ?? 0,
    currency: safeCurrency(item.currency || 'BRL'),
    category: safeToken(item.category || 'OTHER'),
    paymentMethod: PAYMENT_METHODS.has(safeToken(item.paymentMethod)) ? safeToken(item.paymentMethod) : 'OTHER',
    status: EXPENSE_STATUSES.has(safeToken(item.status)) ? safeToken(item.status) : 'PLANNED',
    essential: item.essential === true || ESSENTIAL_CATEGORIES.has(safeToken(item.category)),
    source: safeString(item.source, 120)
  })).filter((item) => item.amount > 0);
}

function normalizePaymentRequirements(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 1000).map((item, index) => ({
    id: safeString(item.id, 160) || `payment-${index + 1}`,
    title: safeString(item.title, 220) || 'Pagamento',
    required: item.required !== false,
    amount: optionalMoney(item.amount),
    currency: item.currency ? safeCurrency(item.currency) : null,
    acceptedMethods: unique((Array.isArray(item.acceptedMethods) ? item.acceptedMethods : []).map(safeToken).filter((method) => PAYMENT_METHODS.has(method))),
    acceptanceVerified: item.acceptanceVerified === true,
    source: safeString(item.source, 120)
  })).map((item) => item.acceptanceVerified ? item : { ...item, acceptedMethods: [] });
}

function normalizeCategoryTargets(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output = {};
  for (const [key, value] of Object.entries(input).slice(0, 50)) {
    const category = safeToken(key);
    const amount = optionalMoney(value);
    if (category && amount !== null) output[category] = amount;
  }
  return output;
}

function normalizeFx(input) {
  if (!input || typeof input !== 'object') return null;
  const from = safeCurrency(input.from);
  const to = safeCurrency(input.to);
  const rate = Number(input.rate);
  const observedAt = safeDateTime(input.observedAt || input.updatedAt);
  const provider = safeString(input.provider || input.source, 120);
  if (!from || !to || !Number.isFinite(rate) || rate <= 0 || !provider || !observedAt) return null;
  return { from, to, rate, provider, observedAt, verified: true };
}

function safeCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function optionalMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? money(number) : null;
}

function optionalPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sumKnown(values) {
  return money(values.filter((value) => value !== null).reduce((sum, value) => sum + value, 0));
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function safeToken(value) {
  const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return token || null;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
