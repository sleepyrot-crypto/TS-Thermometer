const axios = require('axios');

// کش برای ذخیره نتایج
const cache = new Map();

// لیست کلمات مثبت و منفی
const positiveWords = [
  'good', 'great', 'excellent', 'amazing', 'awesome', 'fantastic', 'perfect',
  'love', 'wonderful', 'outstanding', 'superb', 'brilliant', 'best', 'nice',
  'happy', 'positive', 'success', 'win', 'winner', 'beautiful', 'cool',
  'impressive', 'recommend', 'enjoy', 'pleased', 'satisfied', 'perfect',
  'bravo', 'congrats', 'yay', 'yeah', 'yes', 'upvote', 'upvoted'
];

const negativeWords = [
  'bad', 'terrible', 'awful', 'horrible', 'worst', 'hate', 'dislike',
  'disappointing', 'poor', 'sucks', 'trash', 'garbage', 'waste', 'useless',
  'stupid', 'dumb', 'ridiculous', 'annoying', 'angry', 'sad', 'negative',
  'fail', 'failure', 'lose', 'loser', 'problem', 'issue', 'bug', 'broken',
  'crash', 'slow', 'expensive', 'overpriced', 'scam', 'fraud', 'downvote',
  'downvoted', 'delete', 'remove'
];

exports.handler = async function(event, context) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { trend1, trend2, forceRefresh = false } = JSON.parse(event.body);

    if (!trend1 || !trend2) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Both trends are required' })
      };
    }

    // ایجاد کلید یکتا برای کش
    const cacheKey = `${trend1.toLowerCase()}_${trend2.toLowerCase()}`;
    const cacheDuration = 10 * 60 * 1000; // 10 دقیقه
    const now = Date.now();
    const cachedData = cache.get(cacheKey);

    // بررسی کش
    if (cachedData && !forceRefresh && (now - cachedData.timestamp < cacheDuration)) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          ...cachedData.data,
          cached: true,
          cacheExpiry: cachedData.timestamp + cacheDuration,
          nextRefresh: cachedData.timestamp + cacheDuration
        })
      };
    }

    // تحلیل جدید
    const [sentiment1, sentiment2] = await Promise.all([
      analyzeSentiment(trend1),
      analyzeSentiment(trend2)
    ]);

    const result = {
      trend1,
      trend2,
      sentiment1,
      sentiment2,
      cached: false,
      timestamp: now,
      nextRefresh: now + cacheDuration,
      message: 'Sentiment analysis completed successfully'
    };

    // ذخیره در کش
    cache.set(cacheKey, {
      data: result,
      timestamp: now
    });

    // پاک کردن کش قدیمی
    cleanupCache();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};

function cleanupCache() {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [key, value] of cache.entries()) {
    if (value.timestamp < oneHourAgo) {
      cache.delete(key);
    }
  }
}

async function analyzeSentiment(trend) {
  try {
    const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(trend)}&limit=30&sort=relevance`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TrendAnalyzer/1.0)'
      },
      timeout: 10000
    });

    const posts = response.data.data.children;
    
    if (posts.length === 0) {
      return 0.5;
    }

    let totalScore = 0;
    let analyzedPosts = 0;

    for (const post of posts) {
      const postData = post.data;
      const text = `${postData.title} ${postData.selftext || ''}`.toLowerCase();
      
      const score = calculateSentimentScore(text);
      totalScore += score;
      analyzedPosts++;
    }

    const averageScore = analyzedPosts > 0 ? totalScore / analyzedPosts : 0.5;
    return Math.max(0, Math.min(1, averageScore));

  } catch (error) {
    console.error(`Error analyzing ${trend}:`, error.message);
    return 0.5;
  }
}

function calculateSentimentScore(text) {
  const words = text.toLowerCase().split(/\s+/);
  
  let positiveCount = 0;
  let negativeCount = 0;
  let totalWords = 0;

  for (const word of words) {
    const cleanWord = word.replace(/[^\w]/g, '');
    if (cleanWord.length < 2) continue;

    if (positiveWords.includes(cleanWord)) positiveCount++;
    if (negativeWords.includes(cleanWord)) negativeCount++;
    totalWords++;
  }

  if (totalWords === 0) return 0.5;

  const positiveRatio = positiveCount / totalWords;
  const negativeRatio = negativeCount / totalWords;

  let score = 0.5 + (positiveRatio - negativeRatio);
  return Math.max(0, Math.min(1, score));
}
