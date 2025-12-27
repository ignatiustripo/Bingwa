{
  "version": 2,
  "builds": [
    {
      "src": "api/mpesa.js",
      "use": "@vercel/node"
    },
    {
      "src": "public/**/*",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/api/mpesa/(.*)",
      "dest": "/api/mpesa.js"
    },
    {
      "src": "/(.*)",
      "dest": "/public/$1"
    }
  ],
  "env": {
    "MPESA_ENVIRONMENT": "sandbox",
    "MPESA_CALLBACK_URL": "https://ignatius-data-hubs.vercel.app/api/mpesa/callback"
  }
}
