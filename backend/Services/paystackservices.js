import axios from 'axios';

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
   * @returns {Promise<object>} Transaction initialization response
   */
  async initializeTransaction(email, amount, metadata = {}) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          email,
          amount: Math.round(amount * 100), // Convert to pesewas
          currency: 'GHS',
          metadata,
          callback_url: process.env.FRONTEND_URL 
            ? `${process.env.FRONTEND_URL}/order/success` 
            : undefined,
        },
        { headers: this.headers }
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
   * @returns {Promise<object>} Transaction verification response
   */
  async verifyTransaction(reference) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction/verify/${reference}`,
        { headers: this.headers }
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
   * @returns {Promise<object>} Charge response
   */
  async chargeAuthorization(authorizationCode, email, amount) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/charge_authorization`,
        {
          authorization_code: authorizationCode,
          email,
          amount: Math.round(amount * 100),
          currency: 'GHS',
        },
        { headers: this.headers }
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
   * @returns {Promise<object>} List of transactions
   */
  async listTransactions(perPage = 50, page = 1) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction?perPage=${perPage}&page=${page}`,
        { headers: this.headers }
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
   * @returns {Promise<object>} Transfer recipient response
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
          currency: 'GHS',
        },
        { headers: this.headers }
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
   * @returns {Promise<object>} Transfer response
   */
  async initiateTransfer(amount, recipient, reason = '') {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transfer`,
        {
          source: 'balance',
          amount: Math.round(amount * 100),
          recipient,
          reason,
          currency: 'GHS',
        },
        { headers: this.headers }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Transfer failed');
    }
  }

  /**
   * Get list of banks
   * @param {string} country - Country code (default: 'ghana')
   * @returns {Promise<object>} List of banks
   */
  async getBankList(country = 'ghana') {
    try {
      const response = await axios.get(
        `${this.baseUrl}/bank?country=${country}`,
        { headers: this.headers }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch banks');
    }
  }

  /**
   * Resolve account number
   * @param {string} accountNumber - Account number
   * @param {string} bankCode - Bank code
   * @returns {Promise<object>} Account details
   */
  async resolveAccountNumber(accountNumber, bankCode) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        { headers: this.headers }
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
   * @returns {Promise<object>} Transaction details
   */
  async fetchTransaction(id) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction/${id}`,
        { headers: this.headers }
      );
      return response.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message || 'Failed to fetch transaction'
      );
    }
  }
}

export default new PaystackService();