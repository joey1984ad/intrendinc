const fetch = require('node-fetch');
// Using the token directly from gcloud auth
const { execSync } = require('child_process');
const accessToken = execSync('gcloud auth print-access-token').toString().trim();

async function test() {
  const url = 'https://googleads.googleapis.com/v18/customers:listAccessibleCustomers';
  console.log('Token:', accessToken.substring(0, 10) + '...');
  
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json'
  };
  
  console.log('Developer Token:', process.env.GOOGLE_ADS_DEVELOPER_TOKEN);

  try {
    const response = await fetch(url, { method: 'GET', headers });
    const text = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}
test();
