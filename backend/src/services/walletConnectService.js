const WalletConnect = require('@walletconnect/client').default;
const { formatJsonRpcRequest } = require('@walletconnect/utils');
const { ethers } = require('ethers');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

class WalletConnectService {
  constructor() {
    this.sessions = new Map(); // Store active sessions
    this.connectors = new Map(); // Store WalletConnect connectors
    this.projectId = process.env.WALLETCONNECT_PROJECT_ID;
    this.relayUrl = process.env.WALLETCONNECT_RELAY_URL;
  }

  // Create new WalletConnect session
  async createSession(sessionId) {
    try {
      const connector = new WalletConnect({
        bridge: this.relayUrl,
        qrcodeModal: null, // We'll handle QR code on frontend
        clientMeta: {
          description: 'EventChain - Decentralized Event Gaming Platform',
          url: process.env.API_BASE_URL,
          icons: ['https://walletconnect.org/walletconnect-logo.png'],
          name: 'EventChain'
        }
      });

      // Store connector
      this.connectors.set(sessionId, connector);

      // Set up event listeners
      connector.on('connect', (error, payload) => {
        if (error) {
          logger.error('WalletConnect connection error:', error);
          return;
        }

        const { accounts, chainId } = payload.params[0];
        const session = {
          sessionId,
          accounts,
          chainId,
          connected: true,
          connectedAt: new Date().toISOString()
        };

        this.sessions.set(sessionId, session);
        logger.info(`Wallet connected: ${accounts[0]} on chain ${chainId}`);
      });

      connector.on('session_update', (error, payload) => {
        if (error) {
          logger.error('WalletConnect session update error:', error);
          return;
        }

        const { accounts, chainId } = payload.params[0];
        const session = this.sessions.get(sessionId);
        if (session) {
          session.accounts = accounts;
          session.chainId = chainId;
          this.sessions.set(sessionId, session);
        }
      });

      connector.on('disconnect', (error, payload) => {
        if (error) {
          logger.error('WalletConnect disconnect error:', error);
        }

        this.sessions.delete(sessionId);
        this.connectors.delete(sessionId);
        logger.info(`Wallet disconnected: ${sessionId}`);
      });

      // Create session
      if (!connector.connected) {
        await connector.createSession();
      }

      return {
        success: true,
        sessionId,
        uri: connector.uri,
        connected: connector.connected,
        accounts: connector.accounts,
        chainId: connector.chainId
      };
    } catch (error) {
      logger.error('Failed to create WalletConnect session:', error);
      throw error;
    }
  }

  // Get session info
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: 'Session not found'
      };
    }

    return {
      success: true,
      session
    };
  }

  // Kill session
  async killSession(sessionId) {
    try {
      const connector = this.connectors.get(sessionId);
      if (connector && connector.connected) {
        await connector.killSession();
      }

      this.sessions.delete(sessionId);
      this.connectors.delete(sessionId);

      logger.info(`Session killed: ${sessionId}`);

      return {
        success: true,
        sessionId
      };
    } catch (error) {
      logger.error('Failed to kill WalletConnect session:', error);
      throw error;
    }
  }

  // Send transaction request
  async sendTransaction(sessionId, transaction) {
    try {
      const connector = this.connectors.get(sessionId);
      if (!connector || !connector.connected) {
        throw new Error('Wallet not connected');
      }

      const customRequest = formatJsonRpcRequest('eth_sendTransaction', [transaction]);
      const result = await connector.sendCustomRequest(customRequest);

      logger.info(`Transaction sent via WalletConnect: ${result}`);

      return {
        success: true,
        transactionHash: result,
        sessionId
      };
    } catch (error) {
      logger.error('Failed to send transaction via WalletConnect:', error);
      throw error;
    }
  }

  // Sign message
  async signMessage(sessionId, message, address) {
    try {
      const connector = this.connectors.get(sessionId);
      if (!connector || !connector.connected) {
        throw new Error('Wallet not connected');
      }

      const msgParams = [message, address];
      const customRequest = formatJsonRpcRequest('personal_sign', msgParams);
      const signature = await connector.sendCustomRequest(customRequest);

      logger.info(`Message signed via WalletConnect for address: ${address}`);

      return {
        success: true,
        signature,
        message,
        address,
        sessionId
      };
    } catch (error) {
      logger.error('Failed to sign message via WalletConnect:', error);
      throw error;
    }
  }

  // Verify signature
  verifySignature(message, signature, expectedAddress) {
    try {
      const recoveredAddress = ethers.verifyMessage(message, signature);
      const isValid = recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();

      logger.info(`Signature verification: ${isValid ? 'valid' : 'invalid'} for ${expectedAddress}`);

      return {
        success: true,
        valid: isValid,
        recoveredAddress,
        expectedAddress
      };
    } catch (error) {
      logger.error('Failed to verify signature:', error);
      return {
        success: false,
        valid: false,
        error: error.message
      };
    }
  }

  // Generate authentication challenge
  generateAuthChallenge(address, sessionId) {
    const nonce = Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();
    const challenge = `EventChain Authentication\n\nAddress: ${address}\nSession: ${sessionId}\nNonce: ${nonce}\nTimestamp: ${timestamp}`;

    return {
      challenge,
      nonce,
      timestamp
    };
  }

  // Authenticate user with signed message
  async authenticateUser(sessionId, address, signature, challenge) {
    try {
      // Verify signature
      const verification = this.verifySignature(challenge, signature, address);
      if (!verification.valid) {
        throw new Error('Invalid signature');
      }

      // Check session
      const session = this.sessions.get(sessionId);
      if (!session || !session.accounts.includes(address)) {
        throw new Error('Address not associated with session');
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          address: address.toLowerCase(),
          sessionId,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
        },
        process.env.JWT_SECRET
      );

      // Update session with auth info
      session.authenticated = true;
      session.address = address.toLowerCase();
      session.token = token;
      session.authenticatedAt = new Date().toISOString();
      this.sessions.set(sessionId, session);

      logger.info(`User authenticated: ${address} in session ${sessionId}`);

      return {
        success: true,
        token,
        address: address.toLowerCase(),
        sessionId,
        expiresIn: '24h'
      };
    } catch (error) {
      logger.error('Failed to authenticate user:', error);
      throw error;
    }
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const session = this.sessions.get(decoded.sessionId);

      if (!session || !session.authenticated) {
        throw new Error('Session not found or not authenticated');
      }

      return {
        success: true,
        valid: true,
        decoded,
        session
      };
    } catch (error) {
      logger.error('Failed to verify JWT token:', error);
      return {
        success: false,
        valid: false,
        error: error.message
      };
    }
  }

  // Get all active sessions
  getActiveSessions() {
    const activeSessions = Array.from(this.sessions.values()).filter(
      session => session.connected
    );

    return {
      success: true,
      sessions: activeSessions,
      count: activeSessions.length
    };
  }

  // Get user's active session by address
  getUserSession(address) {
    const session = Array.from(this.sessions.values()).find(
      s => s.authenticated && s.address === address.toLowerCase()
    );

    if (!session) {
      return {
        success: false,
        error: 'No active session found for address'
      };
    }

    return {
      success: true,
      session
    };
  }

  // Send custom request to wallet
  async sendCustomRequest(sessionId, method, params) {
    try {
      const connector = this.connectors.get(sessionId);
      if (!connector || !connector.connected) {
        throw new Error('Wallet not connected');
      }

      const customRequest = formatJsonRpcRequest(method, params);
      const result = await connector.sendCustomRequest(customRequest);

      logger.info(`Custom request sent: ${method}`);

      return {
        success: true,
        result,
        method,
        sessionId
      };
    } catch (error) {
      logger.error(`Failed to send custom request ${method}:`, error);
      throw error;
    }
  }

  // Switch network
  async switchNetwork(sessionId, chainId) {
    try {
      const params = [{
        chainId: `0x${chainId.toString(16)}`
      }];

      const result = await this.sendCustomRequest(sessionId, 'wallet_switchEthereumChain', params);

      logger.info(`Network switch requested: ${chainId}`);

      return result;
    } catch (error) {
      logger.error('Failed to switch network:', error);
      throw error;
    }
  }

  // Add network
  async addNetwork(sessionId, networkConfig) {
    try {
      const params = [networkConfig];
      const result = await this.sendCustomRequest(sessionId, 'wallet_addEthereumChain', params);

      logger.info(`Network add requested: ${networkConfig.chainName}`);

      return result;
    } catch (error) {
      logger.error('Failed to add network:', error);
      throw error;
    }
  }

  // Cleanup expired sessions
  cleanupExpiredSessions() {
    const now = Date.now();
    const expiredSessions = [];

    this.sessions.forEach((session, sessionId) => {
      const sessionAge = now - new Date(session.connectedAt).getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      if (sessionAge > maxAge) {
        expiredSessions.push(sessionId);
      }
    });

    expiredSessions.forEach(sessionId => {
      this.killSession(sessionId);
    });

    if (expiredSessions.length > 0) {
      logger.info(`Cleaned up ${expiredSessions.length} expired sessions`);
    }

    return {
      success: true,
      cleanedUp: expiredSessions.length
    };
  }
}

module.exports = new WalletConnectService(); 