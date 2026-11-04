// @ts-check
import axios from 'axios';
import { CHARGED_CURRENCY } from './paymentCurrency.js';
import { frontendBaseUrl } from '../config/frontendOrigins.js';

// FV-5: axios has no default timeout, so a hung Paystack connection held a
// checkout, refund or scheduled money job (and its lock) indefinitely. A
// timeout surfaces as an error with no provider response, which every money
// path already treats as an UNKNOWN outcome (claim kept, reconciled later).
// Same bound as transferReconciliationService.
export const PAYSTACK_TIMEOUT_MS = 15000;

/**
 * Standard Paystack API envelope. `data` carries endpoint-specific fields
 * (reference, status, authorization_url, transfer_code, ...) which are opaque
 * here — the important money invariant (amounts are converted to pesewas with
 * `Math.round(amount * 100)`) is kept at the call sites.
 * @typedef {Object} PaystackEnvelope
 * @property {boolean} status
 * @property {string} message
 * @property {Object<string, any>} [data]
 */

class PaystackService {
  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
    this.baseUrl = 'https://api.paystack.co';
    this.headers = {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Initialize a transaction
   * @param {string} email - Customer email
   * @param {number} amount - Amount in GHS (will be converted to pesewas)
   * @param {object} metadata - Additional transaction data
   * @returns {Promise<PaystackEnvelope>} Transaction initialization response
   */
  async initializeTransaction(email, amount, metadata = {}) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          email,
          amount: Math.round(amount * 100), // Convert to pesewas
          currency: CHARGED_CURRENCY,
          metadata,
          callback_url: frontendBaseUrl()
            ? `${frontendBaseUrl()}/order/success` 
            : undefined,
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message || 'Transaction initialization failed'
      );
    }
  }

  /**
   * Verify a transaction
   * @param {string} reference - Transaction reference
   * @returns {Promise<PaystackEnvelope>} Transaction verification response
   */
  async verifyTransaction(reference) {
    // The reference is interpolated into a URL path. Callers pass it straight
    // from req.body in the custom-order checkout, so it is validated here (at
    // the boundary) and encoded, rather than trusting every call site.
    if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(reference)) {
      throw new Error('Invalid payment reference');
    }
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message || 'Transaction verification failed'
      );
    }
  }

  /**
   * Charge an authorization
   * @param {string} authorizationCode - Authorization code from previous transaction
   * @param {string} email - Customer email
   * @param {number} amount - Amount in GHS
   * @returns {Promise<PaystackEnvelope>} Charge response
   */
  async chargeAuthorization(authorizationCode, email, amount) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/charge_authorization`,
        {
          authorization_code: authorizationCode,
          email,
          amount: Math.round(amount * 100),
          currency: CHARGED_CURRENCY,
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Charge failed');
    }
  }

  /**
   * List transactions
   * @param {number} perPage - Number of transactions per page
   * @param {number} page - Page number
   * @returns {Promise<PaystackEnvelope>} List of transactions
   */
  async listTransactions(perPage = 50, page = 1) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction?perPage=${perPage}&page=${page}`,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message || 'Failed to fetch transactions'
      );
    }
  }

  /**
   * Create a transfer recipient
   * @param {string} type - Recipient type (e.g., 'nuban', 'mobile_money')
   * @param {string} name - Recipient name
   * @param {string} accountNumber - Account number
   * @param {string} bankCode - Bank code
   * @returns {Promise<PaystackEnvelope>} Transfer recipient response
   */
  async createTransferRecipient(type, name, accountNumber, bankCode) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transferrecipient`,
        {
          type,
          name,
          account_number: accountNumber,
          bank_code: bankCode,
          currency: CHARGED_CURRENCY,
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message || 'Failed to create recipient'
      );
    }
  }

  /**
   * Initiate a transfer
   * @param {number} amount - Amount in GHS
   * @param {string} recipient - Recipient code
   * @param {string} reason - Transfer reason
   * @param {string} [reference] - Our idempotency key, persisted before this call
   * @returns {Promise<PaystackEnvelope>} Transfer response
   */
  async initiateTransfer(amount, recipient, reason = '', reference) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transfer`,
        {
          source: 'balance',
          amount: Math.round(amount * 100),
          recipient,
          reason,
          currency: CHARGED_CURRENCY,
          // The reference is generated ONCE per payout attempt and persisted
          // in payout_attempts BEFORE this call (see escrowService), so if the
          // response is lost, reconciliation verifies this exact reference —
          // Paystack treats a repeated reference as the same transfer rather
          // than a new payout. A NEW withdrawal attempt deliberately gets a
          // NEW reference because it claims fresh funds.
          ...(reference ? { reference } : {}),
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      // Same shape as refundTransaction: callers must be able to tell "the
      // provider answered" from "no answer" (timeout/network), because only
      // provider evidence may ever release a reserved payout.
      const err = new Error(error.response?.data?.message || 'Transfer failed');
      Object.assign(err, {
        hadProviderResponse: Boolean(error.response),
        providerStatus: error.response?.status ?? null,
      });
      throw err;
    }
  }

  /**
   * Get list of banks
   * @param {string} country - Country code (default: 'ghana')
   * @returns {Promise<PaystackEnvelope>} List of banks
   */
  async getBankList(country = 'ghana') {
    try {
      const response = await axios.get(
        `${this.baseUrl}/bank?country=${country}`,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch banks');
    }
  }

  /**
   * Get list of mobile money telcos for a country/currency.
   * @param {string} currency - Currency (default: 'GHS')
   * @returns {Promise<PaystackEnvelope>} List of mobile money providers
   */
  async getMobileMoneyTelcos(currency = 'GHS') {
    try {
      const response = await axios.get(
        `${this.baseUrl}/bank?currency=${currency}&type=mobile_money`,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch mobile money providers');
    }
  }

  /**
   * Create a transfer recipient for mobile money (momo).
   * Uses the telco code as bank_code and the phone number as account_number.
   * @param {string} name - Recipient name
   * @param {string} phone - Mobile money phone number
   * @param {string} telco - Telco code (e.g. 'MTN', 'VOD', 'ATL', 'TGO')
   * @returns {Promise<PaystackEnvelope>} Transfer recipient response
   */
  async createMomoRecipient(name, phone, telco) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transferrecipient`,
        {
          type: 'mobile_money',
          name,
          account_number: phone,
          bank_code: telco,
          currency: CHARGED_CURRENCY,
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create mobile money recipient');
    }
  }

  /**
   * Resolve account number
   * @param {string} accountNumber - Account number
   * @param {string} bankCode - Bank code
   * @returns {Promise<PaystackEnvelope>} Account details
   */
  async resolveAccountNumber(accountNumber, bankCode) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message || 'Failed to resolve account'
      );
    }
  }

  /**
   * Fetch transaction
   * @param {number} id - Transaction ID
   * @returns {Promise<PaystackEnvelope>} Transaction details
   */
  async fetchTransaction(id) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction/${id}`,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message || 'Failed to fetch transaction'
      );
    }
  }

  /**
   * Refund a transaction (full refund by default).
   * @param {string} reference - Transaction reference to refund
   * @param {number} [amountGhs] - Optional amount in GHS to refund (partial). Omit for full refund.
   * @param {string} [reason] - Optional refund reason
   * @returns {Promise<PaystackEnvelope>} Refund response
   */
  async refundTransaction(reference, amountGhs, reason = '') {
    try {
      const payload = {
        transaction: reference,
        ...(reason ? { reason } : {}),
        ...(amountGhs !== undefined && amountGhs !== null
          ? { amount: Math.round(Number(amountGhs) * 100) } // to pesewas
          : {}),
      };
      const response = await axios.post(
        `${this.baseUrl}/refund`,
        payload,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      // Preserve enough provider context for callers to distinguish a
      // DEFINITIVE rejection (the provider answered — no money moved, so the
      // caller may release its refund claim and let a retry re-attempt) from
      // an UNKNOWN outcome (timeout / network drop / 5xx — the refund MAY
      // have been accepted, so the claim must be kept and the actual refund
      // state reconciled from the provider before anything is re-issued).
      // Object.assign (not direct property writes) keeps this file clean
      // under checkJs: Error has no such declared properties.
      const err = new Error(
        error.response?.data?.message || 'Refund failed'
      );
      Object.assign(err, {
        hadProviderResponse: Boolean(error.response),
        providerStatus: error.response?.status ?? null,
      });
      throw err;
    }
  }

  /**
   * List the refunds that exist at Paystack for a transaction. Used by refund
   * reconciliation to establish the ACTUAL provider-side refund state instead
   * of trusting a stored claim marker or a caller's memory of a call.
   * @param {string|number} transactionRefOrId - Transaction reference or id
   * @param {number} [perPage]
   * @returns {Promise<PaystackEnvelope>} Refund rows ({ id, status, amount, transaction, ... })
   */
  async listRefunds(transactionRefOrId, perPage = 50) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/refund?transaction=${encodeURIComponent(String(transactionRefOrId))}&perPage=${perPage}`,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message || 'Failed to fetch refunds'
      );
    }
  }

  // --- Vendor plan subscriptions (recurring billing) ----------------------

  /**
   * Create a billing Plan on Paystack. Called when an admin activates a vendor
   * plan; the returned plan_code is initialized against to start subscriptions.
   * @param {string} name
   * @param {number} amount - Amount in GHS (converted to pesewas)
   * @param {'monthly'|'annually'} interval
   * @returns {Promise<PaystackEnvelope>} { data: { plan_code, ... } }
   */
  async createPlan(name, amount, interval) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/plan`,
        { name, amount: Math.round(amount * 100), interval, currency: CHARGED_CURRENCY },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create plan');
    }
  }

  /**
   * Update a Paystack Plan's amount/name (admin edits a plan's price).
   * @param {string} planCode
   * @param {{ name?: string, amount?: number, interval?: 'monthly'|'annually' }} fields
   * @returns {Promise<PaystackEnvelope>}
   */
  async updatePlan(planCode, fields) {
    try {
      const body = { ...fields };
      if (typeof fields.amount === 'number') body.amount = Math.round(fields.amount * 100);
      const response = await axios.put(
        `${this.baseUrl}/plan/${encodeURIComponent(planCode)}`,
        body,
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update plan');
    }
  }

  /**
   * Start a subscription checkout: initialize a transaction bound to a plan.
   * Once the vendor pays, Paystack creates the subscription and charges it on
   * the plan's interval automatically. A unique `reference` lets us correlate
   * the first charge.success webhook back to our pending subscription row.
   * @param {string} email
   * @param {number} amount - Amount in GHS (the plan fee)
   * @param {string} planCode - Paystack plan_code
   * @param {string} reference - our unique reference
   * @param {object} metadata
   * @returns {Promise<PaystackEnvelope>} { data: { authorization_url, reference, ... } }
   */
  async initializeSubscription(email, amount, planCode, reference, metadata = {}) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          email,
          amount: Math.round(amount * 100),
          currency: CHARGED_CURRENCY,
          plan: planCode,
          reference,
          metadata,
          callback_url: frontendBaseUrl() ? `${frontendBaseUrl()}/vendor/plan/success` : undefined,
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to start subscription');
    }
  }

  /**
   * Start a gift-card purchase checkout: a one-off charge with our own
   * reference + metadata so the charge.success webhook can issue the card.
   * @param {string} email buyer email
   * @param {number} amount gift-card value in GHS
   * @param {string} reference our unique reference
   * @param {object} metadata
   * @returns {Promise<PaystackEnvelope>} { data: { authorization_url, reference } }
   */
  async initializeGiftCardPurchase(email, amount, reference, metadata = {}) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          email,
          amount: Math.round(amount * 100),
          currency: CHARGED_CURRENCY,
          reference,
          metadata,
          callback_url: frontendBaseUrl() ? `${frontendBaseUrl()}/gift-cards/success` : undefined,
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to start gift card purchase');
    }
  }

  /**
   * Start a Kente Club membership checkout (recurring, bound to a plan).
   * @param {string} email @param {number} amount GHS @param {string} planCode
   * @param {string} reference @param {object} metadata
   * @returns {Promise<PaystackEnvelope>}
   */
  async initializeMembership(email, amount, planCode, reference, metadata = {}) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          email,
          amount: Math.round(amount * 100),
          currency: CHARGED_CURRENCY,
          plan: planCode,
          reference,
          metadata,
          callback_url: frontendBaseUrl() ? `${frontendBaseUrl()}/kente-club/success` : undefined,
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to start membership');
    }
  }

  /**
   * Start a featured-listing purchase (one-off charge, our own reference).
   * @param {string} email @param {number} amount GHS @param {string} reference
   * @param {object} metadata
   * @returns {Promise<PaystackEnvelope>}
   */
  async initializeFeaturedPurchase(email, amount, reference, metadata = {}) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          email,
          amount: Math.round(amount * 100),
          currency: CHARGED_CURRENCY,
          reference,
          metadata,
          callback_url: frontendBaseUrl() ? `${frontendBaseUrl()}/vendor` : undefined,
        },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to start featured purchase');
    }
  }

  /**
   * Disable (cancel) a subscription at Paystack. Needs the subscription code
   * and its email_token (both captured from the subscription.create webhook).
   * @param {string} subscriptionCode
   * @param {string} emailToken
   * @returns {Promise<PaystackEnvelope>}
   */
  async disableSubscription(subscriptionCode, emailToken) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/subscription/disable`,
        { code: subscriptionCode, token: emailToken },
        { headers: this.headers, timeout: PAYSTACK_TIMEOUT_MS }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to cancel subscription');
    }
  }
}

export default new PaystackService();
