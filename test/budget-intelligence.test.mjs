import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPaymentReadiness,
  budgetIntelligenceCapabilities,
  buildBudgetPlan
} from '../src/budget-intelligence.mjs';

test('budget intelligence treats card and cash as allocations inside the trip budget', () => {
  const capabilities = budgetIntelligenceCapabilities();
  assert.equal(capabilities.localCashPolicy.shouldBeConsideredWhenDestinationCurrencyDiffers, true);

  const result = buildBudgetPlan({
    budget: {
      homeCurrency: 'BRL',
      destinationCurrency: 'EUR',
      totalBudget: 10000,
      cardBudget: 8000,
      cashBudget: 2000,
      localCashOnHand: 300,
      emergencyCashTargetLocal: 200,
      fxRate: {
        from: 'BRL',
        to: 'EUR',
        rate: 0.16,
        provider: 'TEST_FX',
        observedAt: '2027-01-01T10:00:00Z'
      }
    }
  });

  assert.equal(result.allocation.unallocatedHome, 0);
  assert.equal(result.localCash.currency, 'EUR');
  assert.equal(result.localCash.shortfall, 0);
  assert.equal(result.approval.automaticSpendingAllowed, false);
});

test('international trip flags missing local cash and does not invent an FX rate', () => {
  const result = buildBudgetPlan({
    budget: {
      homeCurrency: 'BRL',
      destinationCurrency: 'JPY',
      totalBudget: 12000,
      cardBudget: 10000,
      cashBudget: 2000,
      localCashOnHand: 0,
      emergencyCashTargetLocal: 15000
    }
  });

  assert.ok(result.warnings.includes('NO_LOCAL_CURRENCY_ON_HAND'));
  assert.ok(result.warnings.includes('LOCAL_CASH_RESERVE_INSUFFICIENT'));
  assert.ok(result.researchNeeds.includes('VERIFIED_FX_RATE_FOR_LOCAL_CASH_CONVERSION'));
  assert.equal(result.budget.fx, null);
});

test('verified cash-only required expense checks local-currency readiness', () => {
  const result = buildBudgetPlan({
    budget: {
      homeCurrency: 'BRL',
      destinationCurrency: 'EUR',
      totalBudget: 5000,
      cardBudget: 4500,
      cashBudget: 500,
      localCashOnHand: 40,
      emergencyCashTargetLocal: 50
    },
    paymentRequirements: [
      {
        id: 'local-market',
        title: 'Mercado local',
        required: true,
        amount: 60,
        currency: 'EUR',
        acceptedMethods: ['CASH'],
        acceptanceVerified: true,
        source: 'USER_CONFIRMED'
      }
    ]
  });

  assert.ok(result.warnings.includes('LOCAL_CASH_RESERVE_INSUFFICIENT'));
  assert.ok(result.paymentReadiness.warnings.includes('INSUFFICIENT_LOCAL_CASH_FOR_REQUIRED_ITEM:local-market'));
  assert.ok(result.paymentReadiness.actions.includes('ACQUIRE_LOCAL_CASH_FOR:local-market'));
  assert.equal(result.localCash.requiredLocalCashTarget, 110);
});

test('unknown merchant acceptance remains a research need instead of assuming card or cash', () => {
  const readiness = assessPaymentReadiness({
    budget: {
      homeCurrency: 'BRL',
      destinationCurrency: 'USD',
      totalBudget: 4000,
      cardBudget: 3500,
      cashBudget: 500,
      localCashOnHand: 100
    },
    paymentRequirements: [
      {
        id: 'tour-ticket',
        title: 'Ingresso',
        required: true,
        amount: 20,
        currency: 'USD',
        acceptedMethods: ['CREDIT_CARD'],
        acceptanceVerified: false
      }
    ]
  });

  assert.equal(readiness.ready, false);
  assert.ok(readiness.researchNeeds.includes('PAYMENT_METHOD_ACCEPTANCE:tour-ticket'));
});

test('committed spending reduces the correct card and cash envelopes without treating credit limit as budget', () => {
  const result = buildBudgetPlan({
    budget: {
      homeCurrency: 'BRL',
      destinationCurrency: 'BRL',
      totalBudget: 3000,
      cardBudget: 2200,
      cashBudget: 800,
      localCashOnHand: 800
    },
    expenses: [
      { id: 'hotel', amount: 1200, currency: 'BRL', category: 'LODGING', paymentMethod: 'CREDIT_CARD', status: 'COMMITTED' },
      { id: 'meal', amount: 100, currency: 'BRL', category: 'FOOD', paymentMethod: 'CASH', status: 'PAID' }
    ]
  });

  assert.equal(result.spending.remainingTotalHome, 1700);
  assert.equal(result.spending.cardRemainingHome, 1000);
  assert.equal(result.spending.cashRemainingHome, 700);
});
