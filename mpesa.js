// api/mpesa.js - WORKING M-Pesa STK Push API for Vercel
const axios = require('axios');

// ==== CONFIGURATION ====
// Set these in Vercel Environment Variables
const CONFIG = {
  CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY || 'YOUR_SANDBOX_CONSUMER_KEY',
  CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET || 'YOUR_SANDBOX_CONSUMER_SECRET',
  BUSINESS_SHORT_CODE: process.env.MPESA_BUSINESS_SHORT_CODE || '7894520', // YOUR TILL NUMBER
  PASS_KEY: process.env.MPESA_PASS_KEY || 'YOUR_SANDBOX_PASS_KEY',
  CALLBACK_URL: process.env.MPESA_CALLBACK_URL || 'https://ignatius-data-hubs.vercel.app/api/mpesa-callback',
  ENVIRONMENT: process.env.MPESA_ENVIRONMENT || 'sandbox'
};

// Base URLs
const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke'
};

// In-memory store for transactions
const transactions = new Map();

// ==== HELPER FUNCTIONS ====
function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function generatePassword(timestamp, shortCode) {
  const passwordString = `${shortCode}${CONFIG.PASS_KEY}${timestamp}`;
  return Buffer.from(passwordString).toString('base64');
}

function formatPhoneNumber(phone) {
  let formatted = phone.toString().trim();
  
  formatted = formatted.replace(/\s+|-/g, '');
  
  // Convert to Safaricom format (2547XXXXXXXX)
  if (formatted.startsWith('0')) {
    formatted = '254' + formatted.substring(1);
  } else if (formatted.startsWith('+254')) {
    formatted = formatted.substring(1);
  } else if (formatted.startsWith('254') === false) {
    formatted = '254' + formatted;
  }
  
  // Validate
  if (!/^2547\d{8}$/.test(formatted)) {
    throw new Error('Invalid phone number. Use 07XXXXXXXX or 2547XXXXXXXX');
  }
  
  return formatted;
}

async function getAccessToken() {
  try {
    const BASE_URL = BASE_URLS[CONFIG.ENVIRONMENT] || BASE_URLS.sandbox;
    const authUrl = `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;
    const authString = Buffer.from(`${CONFIG.CONSUMER_KEY}:${CONFIG.CONSUMER_SECRET}`).toString('base64');
    
    console.log('Getting access token from:', authUrl);
    
    const response = await axios.get(authUrl, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('Access token received');
    return response.data.access_token;
  } catch (error) {
    console.error('Access Token Error:', error.message);
    console.error('Response:', error.response?.data);
    throw new Error(`Failed to get access token: ${error.message}`);
  }
}

// ==== MAIN HANDLER ====
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    console.log(`${req.method} ${req.url}`);
    console.log('Environment:', CONFIG.ENVIRONMENT);
    console.log('Till Number:', CONFIG.BUSINESS_SHORT_CODE);

    // ==== HEALTH CHECK ====
    if (req.method === 'GET' && req.url === '/') {
      return res.json({
        status: 'active',
        service: 'Ignatius Data Hubs M-Pesa API',
        environment: CONFIG.ENVIRONMENT,
        till_number: CONFIG.BUSINESS_SHORT_CODE,
        timestamp: new Date().toISOString(),
        transactions: transactions.size
      });
    }

    // ==== INITIATE STK PUSH ====
    if (req.method === 'POST' && req.url === '/stkpush') {
      const { phoneNumber, amount, accountReference = 'Ignatius Data Hubs', transactionDesc = 'Data Purchase' } = req.body;

      console.log('STK Push request:', { phoneNumber, amount });

      // Validation
      if (!phoneNumber || !amount) {
        return res.status(400).json({
          success: false,
          message: 'Phone number and amount are required'
        });
      }

      if (isNaN(amount) || Number(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be a positive number'
        });
      }

      // Format phone
      let formattedPhone;
      try {
        formattedPhone = formatPhoneNumber(phoneNumber);
        console.log('Formatted phone:', formattedPhone);
      } catch (formatError) {
        return res.status(400).json({
          success: false,
          message: formatError.message
        });
      }

      // For sandbox, we use 174379. For production, use the actual till number
      const businessShortCode = CONFIG.ENVIRONMENT === 'sandbox' ? '174379' : CONFIG.BUSINESS_SHORT_CODE;
      
      console.log('Using business short code:', businessShortCode);
      console.log('Environment:', CONFIG.ENVIRONMENT);

      // Get access token
      const accessToken = await getAccessToken();
      const timestamp = getTimestamp();
      const password = generatePassword(timestamp, businessShortCode);

      const BASE_URL = BASE_URLS[CONFIG.ENVIRONMENT] || BASE_URLS.sandbox;

      const stkPushData = {
        BusinessShortCode: businessShortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.floor(amount),
        PartyA: formattedPhone,
        PartyB: businessShortCode,
        PhoneNumber: formattedPhone,
        CallBackURL: CONFIG.CALLBACK_URL,
        AccountReference: accountReference.substring(0, 12),
        TransactionDesc: transactionDesc.substring(0, 13)
      };

      console.log('Sending STK Push to:', BASE_URL);
      console.log('STK Data:', stkPushData);

      try {
        const stkResponse = await axios.post(
          `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
          stkPushData,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );

        console.log('M-Pesa Response:', stkResponse.data);

        if (stkResponse.data.ResponseCode === '0') {
          const transactionId = `IGN${Date.now().toString().slice(-8)}`;
          const transaction = {
            id: transactionId,
            checkoutRequestId: stkResponse.data.CheckoutRequestID,
            merchantRequestId: stkResponse.data.MerchantRequestID,
            phoneNumber: formattedPhone,
            amount: amount,
            accountReference: accountReference,
            status: 'pending',
            createdAt: new Date().toISOString(),
            customerMessage: stkResponse.data.CustomerMessage,
            tillNumber: CONFIG.BUSINESS_SHORT_CODE,
            environment: CONFIG.ENVIRONMENT
          };

          transactions.set(stkResponse.data.CheckoutRequestID, transaction);

          return res.json({
            success: true,
            message: 'STK Push initiated successfully. Check your phone and enter PIN.',
            data: {
              transactionId: transactionId,
              checkoutRequestId: stkResponse.data.CheckoutRequestID,
              merchantRequestId: stkResponse.data.MerchantRequestID,
              customerMessage: stkResponse.data.CustomerMessage,
              phoneNumber: formattedPhone,
              amount: amount,
              accountReference: accountReference,
              tillNumber: CONFIG.BUSINESS_SHORT_CODE,
              environment: CONFIG.ENVIRONMENT
            }
          });
        } else {
          console.error('M-Pesa rejected STK Push:', stkResponse.data);
          return res.status(400).json({
            success: false,
            message: 'STK Push request failed',
            error: stkResponse.data.ResponseDescription,
            response: stkResponse.data
          });
        }

      } catch (apiError) {
        console.error('API Error:', apiError.response?.data || apiError.message);
        
        return res.status(500).json({
          success: false,
          message: 'Failed to connect to M-Pesa',
          error: apiError.message,
          details: CONFIG.ENVIRONMENT === 'sandbox' ? {
            note: 'Sandbox Testing Mode',
            testPhone: '254708374149',
            testPIN: '123456',
            testAmount: '1',
            shortcode: '174379',
            callbackUrl: CONFIG.CALLBACK_URL
          } : null
        });
      }
    }

    // ==== CHECK TRANSACTION STATUS ====
    if (req.method === 'GET' && req.url.startsWith('/status/')) {
      const checkoutRequestId = req.url.split('/status/')[1];
      
      if (!checkoutRequestId) {
        return res.status(400).json({
          success: false,
          message: 'CheckoutRequestID is required'
        });
      }

      console.log('Checking status for:', checkoutRequestId);

      // Check in-memory store
      if (transactions.has(checkoutRequestId)) {
        const transaction = transactions.get(checkoutRequestId);
        
        if (transaction.status === 'completed' || transaction.status === 'failed') {
          return res.json({
            success: true,
            status: transaction.status,
            transaction: transaction
          });
        }
      }

      // If still pending, simulate or query
      return res.json({
        success: true,
        status: 'pending',
        message: 'Payment is still being processed',
        checkoutRequestId: checkoutRequestId
      });
    }

    // ==== GET ALL TRANSACTIONS (for debugging) ====
    if (req.method === 'GET' && req.url === '/transactions') {
      const transactionsArray = Array.from(transactions.values());
      
      return res.json({
        success: true,
        count: transactionsArray.length,
        transactions: transactionsArray
      });
    }

    // ==== GET CONFIG ====
    if (req.method === 'GET' && req.url === '/config') {
      const businessShortCode = CONFIG.ENVIRONMENT === 'sandbox' ? '174379' : CONFIG.BUSINESS_SHORT_CODE;
      
      return res.json({
        success: true,
        config: {
          environment: CONFIG.ENVIRONMENT,
          till_number: CONFIG.BUSINESS_SHORT_CODE,
          business_shortcode: businessShortCode,
          callback_url: CONFIG.CALLBACK_URL,
          has_credentials: !!(CONFIG.CONSUMER_KEY && CONFIG.CONSUMER_SECRET && CONFIG.PASS_KEY)
        },
        testing: CONFIG.ENVIRONMENT === 'sandbox' ? {
          testPhone: '254708374149',
          testPIN: '123456',
          testAmount: '1',
          shortcode: '174379'
        } : null
      });
    }

    // ==== CLEAR TRANSACTIONS (for testing) ====
    if (req.method === 'DELETE' && req.url === '/transactions') {
      const count = transactions.size;
      transactions.clear();
      
      return res.json({
        success: true,
        message: `Cleared ${count} transactions`,
        count: count
      });
    }

    // ==== 404 ====
    return res.status(404).json({
      success: false,
      message: 'Endpoint not found',
      available_endpoints: [
        'GET /',
        'POST /stkpush',
        'GET /status/:checkoutRequestId',
        'GET /transactions',
        'GET /config',
        'DELETE /transactions'
      ]
    });

  } catch (error) {
    console.error('Server Error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
      stack: CONFIG.ENVIRONMENT === 'sandbox' ? error.stack : undefined
    });
  }
};
