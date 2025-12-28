// api/mpesa-callback.js - Callback handler for M-Pesa
const transactions = new Map();

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    });
  }

  try {
    const callbackData = req.body;
    
    console.log('=== M-PESA CALLBACK RECEIVED ===');
    console.log('Callback Data:', JSON.stringify(callbackData, null, 2));

    // Always acknowledge receipt first (M-Pesa requirement)
    res.json({ 
      ResultCode: 0, 
      ResultDesc: 'Success' 
    });

    // Process callback asynchronously
    setTimeout(() => {
      try {
        if (callbackData.Body && callbackData.Body.stkCallback) {
          const stkCallback = callbackData.Body.stkCallback;
          const checkoutRequestId = stkCallback.CheckoutRequestID;
          
          console.log('Processing callback for:', checkoutRequestId);
          console.log('Result Code:', stkCallback.ResultCode);
          console.log('Result Description:', stkCallback.ResultDesc);

          if (stkCallback.ResultCode === 0) {
            // SUCCESSFUL PAYMENT
            console.log('✅ Payment Successful!');
            
            let transactionDetails = {};
            if (stkCallback.CallbackMetadata && stkCallback.CallbackMetadata.Item) {
              const items = stkCallback.CallbackMetadata.Item;
              
              items.forEach(item => {
                transactionDetails[item.Name] = item.Value;
              });
              
              console.log('Transaction Details:', transactionDetails);
            }

            // Update transaction in memory
            if (transactions.has(checkoutRequestId)) {
              const transaction = transactions.get(checkoutRequestId);
              transaction.status = 'completed';
              transaction.mpesaReceiptNumber = transactionDetails.MpesaReceiptNumber;
              transaction.transactionDate = transactionDetails.TransactionDate;
              transaction.completedAt = new Date().toISOString();
              transaction.details = transactionDetails;
              
              console.log('✅ Transaction updated:', {
                id: transaction.id,
                amount: transaction.amount,
                phone: transaction.phoneNumber,
                receipt: transaction.mpesaReceiptNumber,
                till: transaction.tillNumber
              });

              // HERE: You would typically:
              // 1. Send SMS confirmation to customer
              // 2. Activate the purchased data/SMS package
              // 3. Update your database
              // 4. Send email notification
              
            } else {
              console.log('⚠️ Transaction not found:', checkoutRequestId);
              
              // Create new transaction entry if not found
              const transactionId = `IGN${Date.now().toString().slice(-8)}`;
              const transaction = {
                id: transactionId,
                checkoutRequestId: checkoutRequestId,
                status: 'completed',
                mpesaReceiptNumber: transactionDetails.MpesaReceiptNumber,
                transactionDate: transactionDetails.TransactionDate,
                completedAt: new Date().toISOString(),
                details: transactionDetails
              };
              
              transactions.set(checkoutRequestId, transaction);
            }

          } else {
            // FAILED PAYMENT
            console.log('❌ Payment Failed:', stkCallback.ResultDesc);
            
            if (transactions.has(checkoutRequestId)) {
              const transaction = transactions.get(checkoutRequestId);
              transaction.status = 'failed';
              transaction.error = stkCallback.ResultDesc;
              transaction.failedAt = new Date().toISOString();
              
              console.log('❌ Transaction failed:', {
                id: transaction.id,
                amount: transaction.amount,
                phone: transaction.phoneNumber,
                error: transaction.error
              });
            }
          }
        } else {
          console.log('⚠️ Unknown callback format');
        }
      } catch (processError) {
        console.error('Error processing callback:', processError);
      }
    }, 0);

  } catch (error) {
    console.error('Callback handler error:', error);
    
    // Still acknowledge receipt to M-Pesa
    res.json({ 
      ResultCode: 0, 
      ResultDesc: 'Success' 
    });
  }
};
