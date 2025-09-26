const jwt = require('jsonwebtoken');
const walletConnectService = require('../services/walletConnectService');
const logger = require('../utils/logger');

// Authentication middleware
const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token has expired'
        });
      } else if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      } else {
        throw error;
      }
    }

    // Verify session is still active
    const session = await walletConnectService.getSession(decoded.sessionId);
    
    if (!session) {
      return res.status(401).json({
        success: false,
        message: 'Session not found'
      });
    }

    if (!session.authenticated || !session.connected) {
      return res.status(401).json({
        success: false,
        message: 'Session is not authenticated or disconnected'
      });
    }

    // Verify token address matches session
    if (decoded.address.toLowerCase() !== session.accounts[0].toLowerCase()) {
      return res.status(401).json({
        success: false,
        message: 'Token address mismatch'
      });
    }

    // Add user info to request
    req.user = {
      address: decoded.address,
      sessionId: decoded.sessionId,
      chainId: session.chainId,
      authenticatedAt: session.authenticatedAt
    };

    // Add session info for Socket.IO events
    req.session = session;

    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal authentication error'
    });
  }
};

// Optional authentication middleware (doesn't fail if no token)
const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without user info
      req.user = null;
      return next();
    }

    // Use the regular auth middleware
    return authMiddleware(req, res, next);
  } catch (error) {
    // If authentication fails, continue without user info
    req.user = null;
    next();
  }
};

// Admin role middleware (requires additional verification)
const adminMiddleware = async (req, res, next) => {
  try {
    // First run regular authentication
    await new Promise((resolve, reject) => {
      authMiddleware(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Check if user is admin
    const adminAddresses = (process.env.ADMIN_ADDRESSES || '').split(',').map(addr => addr.trim().toLowerCase());
    
    if (!adminAddresses.includes(req.user.address.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    req.user.isAdmin = true;
    next();
  } catch (error) {
    logger.error('Admin middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal authorization error'
    });
  }
};

// Rate limiting middleware for authenticated users
const userRateLimitMiddleware = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const userRequests = new Map();

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next();
      }

      const userAddress = req.user.address.toLowerCase();
      const now = Date.now();
      const windowStart = now - windowMs;

      // Get user's request history
      if (!userRequests.has(userAddress)) {
        userRequests.set(userAddress, []);
      }

      const requests = userRequests.get(userAddress);
      
      // Remove old requests outside the window
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      userRequests.set(userAddress, validRequests);

      // Check if user has exceeded the limit
      if (validRequests.length >= maxRequests) {
        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil((validRequests[0] + windowMs - now) / 1000)
        });
      }

      // Add current request
      validRequests.push(now);
      userRequests.set(userAddress, validRequests);

      next();
    } catch (error) {
      logger.error('User rate limit middleware error:', error);
      next(); // Continue on error
    }
  };
};

// Session validation middleware
const validateSessionMiddleware = async (req, res, next) => {
  try {
    if (!req.user || !req.user.sessionId) {
      return next();
    }

    const session = await walletConnectService.getSession(req.user.sessionId);
    
    if (!session || !session.connected) {
      return res.status(401).json({
        success: false,
        message: 'Wallet session is no longer active'
      });
    }

    // Update last activity
    session.lastActivity = new Date().toISOString();
    
    next();
  } catch (error) {
    logger.error('Session validation middleware error:', error);
    next(); // Continue on error
  }
};

// Blockchain network validation middleware
const networkMiddleware = (requiredChainId) => {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.chainId) {
        return res.status(400).json({
          success: false,
          message: 'Chain ID not available'
        });
      }

      if (req.user.chainId !== requiredChainId) {
        return res.status(400).json({
          success: false,
          message: `Wrong network. Please switch to chain ID ${requiredChainId}`,
          currentChainId: req.user.chainId,
          requiredChainId
        });
      }

      next();
    } catch (error) {
      logger.error('Network middleware error:', error);
      next();
    }
  };
};

// Event participant middleware
const participantMiddleware = async (req, res, next) => {
  try {
    const eventId = req.params.eventId || req.body.eventId;
    
    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: 'Event ID is required'
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user is a participant in the event
    // This would query the blockchain or The Graph to verify participation
    try {
      const hederaService = require('../services/hederaService');
      const participants = await hederaService.getEventParticipants(eventId);
      
      const isParticipant = participants.some(
        participant => participant.toLowerCase() === req.user.address.toLowerCase()
      );

      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          message: 'You must be a participant in this event'
        });
      }

      req.user.isParticipant = true;
      next();
    } catch (error) {
      logger.error('Failed to verify event participation:', error);
      // Continue if verification fails (fallback behavior)
      next();
    }
  } catch (error) {
    logger.error('Participant middleware error:', error);
    next();
  }
};

module.exports = {
  authMiddleware,
  optionalAuthMiddleware,
  adminMiddleware,
  userRateLimitMiddleware,
  validateSessionMiddleware,
  networkMiddleware,
  participantMiddleware
}; 