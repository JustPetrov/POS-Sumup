module.exports = {
  apps: [
    {
      name: 'sumup-service',
      script: 'server.js',
      env: {
        PORT: 3001,
        DB_HOST: 'localhost',
        DB_USER: 'root',
        DB_PASSWORD: 'Ben@2003',
        DB_NAME: 'bendemen_pos',
        SUMUP_API_KEY: 'sup_sk_XkqNSwhnmLs7DJTI7aZrcsYR13yermmXN',
        SUMUP_MERCHANT_CODE: 'MM669XL6'
      }
    }
  ]
};