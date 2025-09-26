const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const walletConnectService = require('../services/walletConnectService');
const logger = require('../utils/logger');

const router = express.Router();

// Create WalletConnect session
router.post('/wallet-connect/session', async (req, res) => {
  try {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const session = await walletConnectService.createSession(sessionId);

    res.json({
      success: true,
      sessionId,
      uri: session.uri,
      message: 'WalletConnect session created. Scan QR code or use URI to connect wallet.'
    });
  } catch (error) {
    logger.error('Failed to create WalletConnect session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create wallet connection session'
    });
  }
});

// Get session status
router.get('/wallet-connect/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await walletConnectService.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        connected: session.connected,
        accounts: session.accounts,
        chainId: session.chainId,
        connectedAt: session.connectedAt
      }
    });
  } catch (error) {
    logger.error('Failed to get session status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve session status'
    });
  }
});

// Authenticate user with signed message
router.post('/authenticate',
  body('sessionId').notEmpty().withMessage('Session ID is required'),
  body('signature').notEmpty().withMessage('Signature is required'),
  body('message').notEmpty().withMessage('Message is required'),
  body('address').isEthereumAddress().withMessage('Valid Ethereum address is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const { sessionId, signature, message, address } = req.body;

      // Verify signature
      const isValid = await walletConnectService.verifySignature(
        sessionId,
        message,
        signature,
        address
      );

      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid signature'
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          address,
          sessionId,
          timestamp: Date.now()
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Store authenticated session
      await walletConnectService.authenticateSession(sessionId, address);

      logger.info(`User authenticated: ${address}`);

      res.json({
        success: true,
        token,
        user: {
          address,
          sessionId,
          authenticatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Authentication failed:', error);
      res.status(500).json({
        success: false,
        message: 'Authentication failed'
      });
    }
  }
);

// Verify JWT token
router.post('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const session = await walletConnectService.getSession(decoded.sessionId);

    if (!session || !session.authenticated) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session'
      });
    }

    res.json({
      success: true,
      user: {
        address: decoded.address,
        sessionId: decoded.sessionId,
        authenticated: true
      }
    });
  } catch (error) {
    logger.error('Token verification failed:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
});

// Disconnect wallet
router.post('/disconnect', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    await walletConnectService.disconnectSession(sessionId);

    res.json({
      success: true,
      message: 'Wallet disconnected successfully'
    });
  } catch (error) {
    logger.error('Failed to disconnect wallet:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect wallet'
    });
  }
});

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const session = await walletConnectService.getSession(decoded.sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Get additional user data (could be extended to include on-chain data)
    const userProfile = {
      address: decoded.address,
      chainId: session.chainId,
      connectedAt: session.connectedAt,
      authenticatedAt: session.authenticatedAt,
      sessionActive: session.connected
    };

    res.json({
      success: true,
      profile: userProfile
    });
  } catch (error) {
    logger.error('Failed to get user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user profile'
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    // Verify current token (even if expired)
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    const session = await walletConnectService.getSession(decoded.sessionId);

    if (!session || !session.authenticated) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session'
      });
    }

    // Generate new token
    const newToken = jwt.sign(
      {
        address: decoded.address,
        sessionId: decoded.sessionId,
        timestamp: Date.now()
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token: newToken
    });
  } catch (error) {
    logger.error('Token refresh failed:', error);
    res.status(401).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
});

module.exports = router;