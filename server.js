require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "res.cloudinary.com", "i.scdn.co"],
      connectSrc: ["'self'", "api.spotify.com", "https://accounts.spotify.com"],
    },
  },
}));

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));

// Logging with timestamps
app.use(morgan('combined', {
  stream: {
    write: (message) => {
      console.log(`[${new Date().toISOString()}] ${message.trim()}`);
    }
  }
}));

// Compression for faster responses
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files with cache control
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
}));

// ==================== SPOTIFY PROXY ENDPOINTS ====================

// Spotify token refresh/logging endpoint (for debugging)
app.get('/api/spotify/status', (req, res) => {
  console.log(`[${new Date().toISOString()}] Spotify status check from ${req.ip}`);
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    message: 'Spotify integration is active. Use OAuth flow from frontend.',
    clientIdConfigured: !!process.env.SPOTIFY_CLIENT_ID,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || `${req.protocol}://${req.get('host')}`
  });
});

// Proxy endpoint to check Spotify token validity (optional, for debugging)
app.post('/api/spotify/verify', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'No token provided' });
  }
  
  console.log(`[${new Date().toISOString()}] Verifying Spotify token from ${req.ip}`);
  
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.status === 200) {
      const data = await response.json();
      res.json({ valid: true, playing: !!data?.item, data: data?.item ? { name: data.item.name, artist: data.item.artists[0]?.name } : null });
    } else if (response.status === 401) {
      res.json({ valid: false, error: 'Token expired' });
    } else if (response.status === 204) {
      res.json({ valid: true, playing: false });
    } else {
      res.json({ valid: false, error: `HTTP ${response.status}` });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Spotify verify error:`, error.message);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

// ==================== HEALTH CHECK & KEEP-ALIVE ====================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

// Keep-alive endpoint for Render
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// ==================== SERVE MAIN PAGE ====================

// Serve index.html with dynamic environment variables injected
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  
  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Error reading index.html:`, err);
      return res.status(500).send('Error loading page');
    }
    
    // Inject environment variables into the HTML
    const injectedHTML = data
      .replace('__SPOTIFY_CLIENT_ID__', process.env.SPOTIFY_CLIENT_ID || '')
      .replace('__SPOTIFY_REDIRECT_URI__', `${req.protocol}://${req.get('host')}/callback`)
      .replace('__ENVIRONMENT__', process.env.NODE_ENV || 'production');
    
    res.send(injectedHTML);
  });
});

// Callback route for Spotify OAuth (optional, if you want server-side handling)
app.get('/callback', (req, res) => {
  console.log(`[${new Date().toISOString()}] OAuth callback received from ${req.ip}`);
  // Redirect to main page with hash fragment for client-side handling
  res.redirect('/#access_token=' + req.query.code);
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
  console.log(`[${new Date().toISOString()}] 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ==================== START SERVER ====================

const server = app.listen(PORT, () => {
  console.log(`
  ═══════════════════════════════════════════════════════════
  🚀 1st.peter mathias - Profile Server
  ═══════════════════════════════════════════════════════════
  📡 Server running on: http://localhost:${PORT}
  🌍 Environment: ${process.env.NODE_ENV || 'development'}
  🎵 Spotify Client ID: ${process.env.SPOTIFY_CLIENT_ID ? '✓ Configured' : '✗ Not configured'}
  ⏰ Started at: ${new Date().toISOString()}
  ═══════════════════════════════════════════════════════════
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] SIGTERM signal received: closing HTTP server`);
  server.close(() => {
    console.log(`[${new Date().toISOString()}] HTTP server closed`);
    process.exit(0);
  });
});

// Keep-alive for Render (prevent sleeping)
setInterval(() => {
  console.log(`[${new Date().toISOString()}] Keep-alive ping - Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
}, 5 * 60 * 1000); // Log every 5 minutes
