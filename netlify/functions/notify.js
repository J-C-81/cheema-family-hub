const webpush = require('web-push');
const fetch = require('node-fetch');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const FIREBASE_URL = process.env.FIREBASE_URL;

webpush.setVapidDetails(
  'mailto:cheema@family.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  try {
    const { payload } = JSON.parse(event.body);

    // Fetch all subscriptions from Firebase
    const res = await fetch(`${FIREBASE_URL}/subscriptions.json`);
    const subs = await res.json();

    if (!subs) {
      return { statusCode: 200, headers, body: JSON.stringify({ sent: 0 }) };
    }

    const entries = Object.entries(subs);
    const results = await Promise.allSettled(
      entries.map(async ([key, sub]) => {
        try {
          await webpush.sendNotification(sub, JSON.stringify(payload));
        } catch (err) {
          // Expired subscription — clean it up from Firebase
          if (err.statusCode === 410 || err.statusCode === 404) {
            await fetch(`${FIREBASE_URL}/subscriptions/${key}.json`, { method: 'DELETE' });
          }
          throw err;
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return { statusCode: 200, headers, body: JSON.stringify({ sent }) };
  } catch (err) {
    console.error('Push error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
