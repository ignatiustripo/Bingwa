// api/mpesa.js - UPDATED FOR TILL NUMBER 7894520
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const router = express.Router();

// Enable CORS
router.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ==== CONFIGURATION FOR IGNATIUS DATA HUBS ====
// TILL NUMBER IS FIXED: 7894520
const CONFIG = {
  CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY || 'YOUR_SANDBOX_CONSUMER_KEY',
  CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET || 'YOUR_SANDBOX_CONSUMER_SECRET',
  BUSINESS_SHORT_CODE: '7894520', // FIXED TILL NUMBER - NO ENV VARIABLE NEEDED
  PASS_KEY: process.env.MPESA_PASS_KEY || 'YOUR_SANDBOX_PASS_KEY',
  CALLBACK_URL: process.env.MPESA_CALLBACK_URL || 'https://ignatius-data-hubs.vercel.app/api/mpesa/callback',
  ENVIRONMENT: process.env.MPESA_ENVIRONMENT || 'sandbox'
};

// Base URLs
const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke'
};
const BASE_URL = BASE_URLS[CONFIG.ENVIRONMENT];

// IMPORTANT: In sandbox, we need to use sandbox shortcode (174379)
// In production, we use the actual till number (7894520)
const getBusinessShortCode = () => {
  return CONFIG.ENVIRONMENT === 'sandbox' ? '174379' : CONFIG.BUSINESS_SHORT_CODE;
};

// Store transactions
const transactions = new Map();

// ==== HELPER FUNCTIONS ====
const getTimestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

const generatePassword = (timestamp) => {
  const shortCode = getBusinessShortCode();
  const passwordString = `${shortCode}${CONFIG.PASS_KEY}${timestamp}`;
  return Buffer.from(passwordString).toString('base64');
};

const formatPhoneNumber = (phone) => {
  let formatted = phone.toString().trim();
  
  formatted = formatted.replace(/\s+|-/g, '');
  
  if (formatted.startsWith('0')) {
    formatted = '254' + formatted.substring(1);
  } else if (formatted.startsWith('+254')) {
    formatted = formatted.substring(1);
  } else if (formatted.startsWith('254') === false) {
    formatted = '254' + formatted;
  }
  
  if (!/^2547\d{8}$/.test(formatted)) {
    throw new Error('Invalid phone number format. Use 07XXXXXXXX or 2547XXXXXXXX');
  }
  
  return formatted;
};

const getAccessToken = async () => {
  try {
    const authUrl = `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;
    const authString = Buffer.from(`${CONFIG.CONSUMER_KEY}:${CONFIG.CONSUMER_SECRET}`).toString('base64');
    
    const response = await axios.get(authUrl, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    return response.data.access_token;
  } catch (error) {
    console.error('Access Token Error:', error.response?.data || error.message);
    throw new Error(`Failed to get access token: ${error.response?.data?.error_message || error.message}`);
  }
};

// ==== API ROUTES ====

// Health Check
router.get('/', (req, res) => {
  res.json({ 
    status: 'active', 
    service: 'Ignatius Data Hubs M-Pesa API',
    environment: CONFIG.ENVIRONMENT,
    till_number: CONFIG.BUSINESS_SHORT_CODE,
    current_business_shortcode: getBusinessShortCode(),
    timestamp: new Date().toISOString()
  });
});

// Initiate STK Push - FIXED FOR TILL 7894520
router.post('/stkpush', async (req, res) => {
  try {
    console.log('STK Push request received:', req.body);
    
    const { phoneNumber, amount, accountReference = 'Ignatius Data Hubs', transactionDesc = 'Data/SMS Purchase' } = req.body;

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

    let formattedPhone;
    try {
      formattedPhone = formatPhoneNumber(phoneNumber);
    } catch (formatError) {
      return res.status(400).json({
        success: false,
        message: formatError.message
      });
    }

    const accessToken = await getAccessToken();
    const timestamp = getTimestamp();
    const password = generatePassword(timestamp);
    
    // Use dynamic short code for sandbox/production
    const businessShortCode = getBusinessShortCode();
    
    const stkPushData = {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.floor(amount),
      PartyA: formattedPhone,
      PartyB: businessShortCode, // This is where the payment goes
      PhoneNumber: formattedPhone,
      CallBackURL: CONFIG.CALLBACK_URL,
      AccountReference: accountReference.substring(0, 12),
      TransactionDesc: transactionDesc.substring(0, 13)
    };

    console.log('Sending STK Push to:', {
      businessShortCode: businessShortCode,
      phone: formattedPhone,
      amount: amount,
      environment: CONFIG.ENVIRONMENT,
      till_number: CONFIG.BUSINESS_SHORT_CODE
    });

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
      const transactionId = Date.now().toString();
      const transaction = {
        id: transactionId,
        checkoutRequestId: stkResponse.data.CheckoutRequestID,
        merchantRequestId: stkResponse.data.MerchantRequestID,
        phoneNumber: formattedPhone,
        amount: amount,
        accountReference: accountReference,
        transactionDesc: transactionDesc,
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
      console.error('STK Push rejected:', stkResponse.data);
      return res.status(400).json({
        success: false,
        message: 'STK Push request failed',
        error: stkResponse.data.ResponseDescription,
        response: stkResponse.data
      });
    }

  } catch (error) {
    console.error('STK Push Error:', error.response?.data || error.message);
    
    let errorMessage = 'Failed to initiate STK Push';
    let errorDetails = error.response?.data?.errorMessage || error.response?.data?.error_message || error.message;
    
    // Sandbox testing info
    if (CONFIG.ENVIRONMENT === 'sandbox') {
      return res.status(500).json({
        success: false,
        message: errorMessage,
        error: errorDetails,
        sandbox_info: {
          note: 'Using Sandbox Environment',
          test_phone: '254708374149',
          test_amount: '1',
          test_pin: '123456',
          sandbox_shortcode: '174379',
          actual_till_number: CONFIG.BUSINESS_SHORT_CODE,
          instruction: 'For production, set MPESA_ENVIRONMENT=production and add real credentials'
        }
      });
    }
    
    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: errorDetails,
      production_info: {
        till_number: CONFIG.BUSINESS_SHORT_CODE,
        note: 'Production environment - using actual till number'
      }
    });
  }
});

// Callback Handler
router.post('/callback', (req, res) => {
  try {
    const callbackData = req.body;
    
    console.log('=== M-PESA CALLBACK ===');
    console.log('Callback:', JSON.stringify(callbackData, null, 2));
    
    res.json({ ResultCode: 0, ResultDesc: 'Success' });

    setTimeout(() => {
      if (callbackData.Body && callbackData.Body.stkCallback) {
        const stkCallback = callbackData.Body.stkCallback;
        const checkoutRequestId = stkCallback.CheckoutRequestID;
        
        console.log('CheckoutRequestID:', checkoutRequestId);
        console.log('ResultCode:', stkCallback.ResultCode);
        
        if (stkCallback.ResultCode === 0) {
          console.log('✅ Payment Successful!');
          
          let transactionDetails = {};
          if (stkCallback.CallbackMetadata && stkCallback.CallbackMetadata.Item) {
            const items = stkCallback.CallbackMetadata.Item;
            
            items.forEach(item => {
              transactionDetails[item.Name] = item.Value;
            });
          }
          
          if (transactions.has(checkoutRequestId)) {
            const transaction = transactions.get(checkoutRequestId);
            transaction.status = 'completed';
            transaction.mpesaReceiptNumber = transactionDetails.MpesaReceiptNumber;
            transaction.completedAt = new Date().toISOString();
            transaction.details = transactionDetails;
            
            console.log('✅ Transaction completed for till:', CONFIG.BUSINESS_SHORT_CODE);
            console.log('Amount:', transaction.amount, 'Phone:', transaction.phoneNumber);
            
            // HERE: Activate the data/SMS for the customer
            // You would typically:
            // 1. Send SMS confirmation to customer
            // 2. Activate the purchased package
            // 3. Update your database
            
          }
        } else {
          console.log('❌ Payment Failed:', stkCallback.ResultDesc);
          
          if (transactions.has(checkoutRequestId)) {
            const transaction = transactions.get(checkoutRequestId);
            transaction.status = 'failed';
            transaction.error = stkCallback.ResultDesc;
            transaction.failedAt = new Date().toISOString();
          }
        }
      }
    }, 0);
    
  } catch (error) {
    console.error('Callback Error:', error);
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  }
});

// Status Check
router.get('/status/:checkoutRequestId', async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    
    if (!checkoutRequestId) {
      return res.status(400).json({
        success: false,
        message: 'CheckoutRequestID is required'
      });
    }
    
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
    
    try {
      const accessToken = await getAccessToken();
      const timestamp = getTimestamp();
      const password = generatePassword(timestamp);
      
      const queryData = {
        BusinessShortCode: getBusinessShortCode(),
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };
      
      const response = await axios.post(
        `${BASE_URL}/mpesa/stkpushquery/v1/query`,
        queryData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      if (response.data.ResultCode === '0') {
        const transaction = transactions.get(checkoutRequestId) || {
          id: Date.now().toString(),
          checkoutRequestId: checkoutRequestId,
          status: 'completed',
          completedAt: new Date().toISOString(),
          tillNumber: CONFIG.BUSINESS_SHORT_CODE
        };
        
        transaction.status = 'completed';
        transaction.queryResponse = response.data;
        transactions.set(checkoutRequestId, transaction);
        
        return res.json({
          success: true,
          status: 'completed',
          message: 'Payment completed successfully',
          transaction: transaction
        });
      } else if (response.data.ResultCode === '1032') {
        return res.json({
          success: true,
          status: 'pending',
          message: 'Payment is still being processed'
        });
      } else {
        const transaction = transactions.get(checkoutRequestId) || {
          id: Date.now().toString(),
          checkoutRequestId: checkoutRequestId,
          status: 'failed',
          failedAt: new Date().toISOString(),
          tillNumber: CONFIG.BUSINESS_SHORT_CODE
        };
        
        transaction.status = 'failed';
        transaction.error = response.data.ResultDesc;
        transaction.queryResponse = response.data;
        transactions.set(checkoutRequestId, transaction);
        
        return res.json({
          success: false,
          status: 'failed',
          message: 'Payment failed',
          error: response.data.ResultDesc
        });
      }
      
    } catch (queryError) {
      console.error('Query Error:', queryError.response?.data || queryError.message);
      
      return res.status(500).json({
        success: false,
        status: 'unknown',
        message: 'Failed to query transaction status'
      });
    }
    
  } catch (error) {
    console.error('Status Check Error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to check transaction status'
    });
  }
});

// Get config endpoint
router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: {
      environment: CONFIG.ENVIRONMENT,
      till_number: CONFIG.BUSINESS_SHORT_CODE,
      business_shortcode: getBusinessShortCode(),
      callback_url: CONFIG.CALLBACK_URL
    },
    instructions: CONFIG.ENVIRONMENT === 'sandbox' ? {
      note: 'SANDBOX MODE - TESTING',
      test_phone: '254708374149',
      test_pin: '123456',
      test_amount: '1',
      sandbox_shortcode: '174379',
      actual_till: CONFIG.BUSINESS_SHORT_CODE
    } : {
      note: 'PRODUCTION MODE - REAL PAYMENTS',
      till_number: CONFIG.BUSINESS_SHORT_CODE,
      message: 'All payments go to Till Number 7894520'
    }
  });
});

// Clear transactions (for testing)
router.delete('/transactions', (req, res) => {
  const count = transactions.size;
  transactions.clear();
  
  res.json({
    success: true,
    message: `Cleared ${count} transactions`,
    count: count
  });
});

module.exports = router;
