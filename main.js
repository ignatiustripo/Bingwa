// api/mpesa.js - M-Pesa STK Push Backend API
const express = require('express');
const axios = require('axios');
const router = express.Router();

// ==== CONFIGURATION - REPLACE WITH YOUR CREDENTIALS ====
// Store these in Vercel Environment Variables for security
const CONFIG = {
  CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY || 'YOUR_SANDBOX_CONSUMER_KEY',
  CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET || 'YOUR_SANDBOX_CONSUMER_SECRET',
  BUSINESS_SHORT_CODE: process.env.MPESA_BUSINESS_SHORT_CODE || '174379', // Sandbox default[citation:1][citation:2]
  PASS_KEY: process.env.MPESA_PASS_KEY || 'YOUR_SANDBOX_PASS_KEY',
  CALLBACK_URL: process.env.MPESA_CALLBACK_URL || 'https://bingwa-sigma.vercel.app/api/mpesa/callback',
  ENVIRONMENT: process.env.MPESA_ENVIRONMENT || 'sandbox' // 'sandbox' or 'production'
};

// Base URLs for different environments[citation:2][citation:3]
const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke'
};
const BASE_URL = BASE_URLS[CONFIG.ENVIRONMENT];

// ==== HELPER FUNCTIONS ====
// Generate timestamp in YYYYMMDDHHmmss format[citation:2]
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

// Generate password (Base64 encoded Shortcode+Passkey+Timestamp)[citation:2][citation:3]
const generatePassword = (timestamp) => {
  const passwordString = `${CONFIG.BUSINESS_SHORT_CODE}${CONFIG.PASS_KEY}${timestamp}`;
  return Buffer.from(passwordString).toString('base64');
};

// Format phone number to 2547XXXXXXXX format[citation:2]
const formatPhoneNumber = (phone) => {
  let formatted = phone.toString().trim();
  
  // Remove any spaces or dashes
  formatted = formatted.replace(/\s+|-/g, '');
  
  // Convert to Safaricom format
  if (formatted.startsWith('0')) {
    formatted = '254' + formatted.substring(1);
  } else if (formatted.startsWith('+254')) {
    formatted = formatted.substring(1);
  } else if (formatted.startsWith('254') === false) {
    formatted = '254' + formatted;
  }
  
  // Ensure it's numeric and valid length
  if (!/^2547\d{8}$/.test(formatted)) {
    throw new Error('Invalid phone number format. Use 07XXXXXXXX or 2547XXXXXXXX');
  }
  
  return formatted;
};

// Get OAuth access token[citation:2]
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

// 1. Health Check Endpoint
router.get('/', (req, res) => {
  res.json({ 
    status: 'active', 
    service: 'M-Pesa STK Push API',
    environment: CONFIG.ENVIRONMENT,
    business_short_code: CONFIG.BUSINESS_SHORT_CODE
  });
});

// 2. Initiate STK Push[citation:2][citation:3]
router.post('/stkpush', async (req, res) => {
  try {
    const { phoneNumber, amount, accountReference = 'Bingwa Shop', transactionDesc = 'Purchase' } = req.body;

    // Input validation
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

    // Format phone number
    let formattedPhone;
    try {
      formattedPhone = formatPhoneNumber(phoneNumber);
    } catch (formatError) {
      return res.status(400).json({
        success: false,
        message: formatError.message
      });
    }

    // Get access token
    const accessToken = await getAccessToken();
    
    // Prepare STK Push request
    const timestamp = getTimestamp();
    const password = generatePassword(timestamp);
    
    const stkPushData = {
      BusinessShortCode: CONFIG.BUSINESS_SHORT_CODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.floor(amount), // Whole numbers only[citation:3]
      PartyA: formattedPhone,
      PartyB: CONFIG.BUSINESS_SHORT_CODE,
      PhoneNumber: formattedPhone,
      CallBackURL: CONFIG.CALLBACK_URL,
      AccountReference: accountReference.substring(0, 12), // Max 12 chars[citation:3]
      TransactionDesc: transactionDesc.substring(0, 13) // Max 13 chars[citation:3]
    };

    // Make STK Push request to Safaricom
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

    // Check if STK Push was accepted[citation:3]
    if (stkResponse.data.ResponseCode === '0') {
      return res.json({
        success: true,
        message: 'STK Push initiated successfully. Check your phone for PIN prompt.',
        data: {
          checkoutRequestId: stkResponse.data.CheckoutRequestID,
          merchantRequestId: stkResponse.data.MerchantRequestID,
          customerMessage: stkResponse.data.CustomerMessage,
          phoneNumber: formattedPhone,
          amount: amount
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'STK Push request failed',
        error: stkResponse.data.ResponseDescription
      });
    }

  } catch (error) {
    console.error('STK Push Error:', error.response?.data || error.message);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate STK Push',
      error: error.response?.data?.errorMessage || error.response?.data?.error_message || error.message,
      details: CONFIG.ENVIRONMENT === 'sandbox' ? (error.response?.data || 'Check your credentials') : undefined
    });
  }
});

// 3. Callback Handler (M-Pesa sends results here)[citation:2][citation:3]
router.post('/callback', (req, res) => {
  try {
    const callbackData = req.body;
    
    // Always acknowledge receipt first[citation:2]
    res.json({ ResultCode: 0, ResultDesc: 'Success' });

    // Process the callback asynchronously
    setTimeout(() => {
      if (callbackData.Body && callbackData.Body.stkCallback) {
        const stkCallback = callbackData.Body.stkCallback;
        
        console.log('=== M-PESA CALLBACK RECEIVED ===');
        console.log('CheckoutRequestID:', stkCallback.CheckoutRequestID);
        console.log('ResultCode:', stkCallback.ResultCode);
        console.log('ResultDesc:', stkCallback.ResultDesc);
        
        if (stkCallback.ResultCode === 0) {
          // SUCCESSFUL PAYMENT[citation:3]
          console.log('✅ Payment Successful!');
          
          if (stkCallback.CallbackMetadata && stkCallback.CallbackMetadata.Item) {
            const items = stkCallback.CallbackMetadata.Item;
            const transactionDetails = {};
            
            items.forEach(item => {
              transactionDetails[item.Name] = item.Value;
            });
            
            console.log('Transaction Details:', {
              amount: transactionDetails.Amount,
              mpesaReceiptNumber: transactionDetails.MpesaReceiptNumber,
              phoneNumber: transactionDetails.PhoneNumber,
              transactionDate: transactionDetails.TransactionDate
            });
            
            // Here you would:
            // 1. Update your database order status
            // 2. Send confirmation email to customer
            // 3. Fulfill the order
            // 4. Log the transaction
            
          }
        } else {
          // FAILED PAYMENT[citation:3]
          console.log('❌ Payment Failed:', stkCallback.ResultDesc);
          console.log('Error Code:', stkCallback.ResultCode);
          
          // Here you would:
          // 1. Update order status to failed
          // 2. Notify customer
          // 3. Log the failure reason
        }
      }
    }, 0);
    
  } catch (error) {
    console.error('Callback Processing Error:', error);
    // Still acknowledge receipt to M-Pesa
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  }
});

// 4. Transaction Status Check (Optional)
router.post('/check-status', async (req, res) => {
  try {
    const { checkoutRequestId } = req.body;
    
    if (!checkoutRequestId) {
      return res.status(400).json({
        success: false,
        message: 'CheckoutRequestID is required'
      });
    }
    
    const accessToken = await getAccessToken();
    const timestamp = getTimestamp();
    const password = generatePassword(timestamp);
    
    const queryData = {
      BusinessShortCode: CONFIG.BUSINESS_SHORT_CODE,
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
        }
      }
    );
    
    res.json({
      success: true,
      data: response.data
    });
    
  } catch (error) {
    console.error('Status Check Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to check transaction status',
      error: error.response?.data || error.message
    });
  }
});

module.exports = router;
