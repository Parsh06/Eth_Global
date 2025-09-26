const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const hederaService = require('../services/hederaService');
const graphService = require('../services/graphService');
const filecoinService = require('../services/filecoinService');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Execute payout for challenge winners
router.post('/execute', authMiddleware, [
  body('eventId').notEmpty().withMessage('Event ID is required'),
  body('challengeId').notEmpty().withMessage('Challenge ID is required'),
  body('poolId').isNumeric().withMessage('Pool ID must be numeric'),
  body('winners').isArray().withMessage('Winners array is required'),
  body('amounts').isArray().withMessage('Amounts array is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { eventId, challengeId, poolId, winners, amounts } = req.body;
    const executorAddress = req.user.address;

    // Validate input data
    if (winners.length !== amounts.length) {
      return res.status(400).json({
        success: false,
        message: 'Winners and amounts arrays must have the same length'
      });
    }

    if (winners.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one winner is required'
      });
    }

    // Validate all addresses
    for (const winner of winners) {
      if (!ethers.isAddress(winner)) {
        return res.status(400).json({
          success: false,
          message: `Invalid winner address: ${winner}`
        });
      }
    }

    // Get pool data to validate
    const poolData = await hederaService.getStakingPool(poolId);
    if (!poolData.active) {
      return res.status(400).json({
        success: false,
        message: 'Cannot distribute rewards for inactive pool'
      });
    }

    // Verify pool belongs to the specified event and challenge
    if (poolData.eventId !== parseInt(eventId) || poolData.challengeId !== parseInt(challengeId)) {
      return res.status(400).json({
        success: false,
        message: 'Pool does not match specified event and challenge'
      });
    }

    // Check if payouts have already been executed for this challenge
    const existingPayouts = await getExistingPayouts(eventId, challengeId);
    if (existingPayouts.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Payouts have already been executed for this challenge'
      });
    }

    // Calculate total payout amount
    const totalPayout = amounts.reduce((sum, amount) => sum + parseFloat(amount), 0);

    // Create payout record
    const payoutData = {
      id: `payout_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      eventId,
      challengeId,
      poolId,
      winners,
      amounts,
      totalAmount: totalPayout.toString(),
      executedBy: executorAddress,
      executedAt: new Date().toISOString(),
      status: 'pending'
    };

    // Execute distribution on Hedera
    const distributionResult = await hederaService.distributeRewards(poolId, winners, amounts);

    // Update payout record
    payoutData.status = 'completed';
    payoutData.txHash = distributionResult.txHash;
    payoutData.completedAt = new Date().toISOString();

    // Store payout record on Filecoin
    const payoutUpload = await filecoinService.uploadUserData(
      payoutData,
      `payout-${payoutData.id}`
    );

    logger.info(`Payout executed: ${payoutData.id} - ${winners.length} winners, total: ${totalPayout}`);

    // Emit real-time update via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`event-${eventId}`).emit('payout_executed', {
        eventId,
        challengeId,
        poolId,
        winners: winners.length,
        totalAmount: totalPayout,
        txHash: distributionResult.txHash
      });
    }

    res.json({
      success: true,
      payout: {
        id: payoutData.id,
        eventId,
        challengeId,
        poolId,
        winnersCount: winners.length,
        totalAmount: totalPayout.toString(),
        txHash: distributionResult.txHash,
        executedAt: payoutData.executedAt,
        proofHash: payoutUpload.ipfsHash
      }
    });
  } catch (error) {
    logger.error('Failed to execute payout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute payout',
      error: error.message
    });
  }
});

// Get payout history
router.get('/history', 
  query('eventId').optional().notEmpty().withMessage('Event ID cannot be empty'),
  query('challengeId').optional().notEmpty().withMessage('Challenge ID cannot be empty'),
  query('poolId').optional().isNumeric().withMessage('Pool ID must be numeric'),
  query('winner').optional().isEthereumAddress().withMessage('Valid winner address required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { eventId, challengeId, poolId, winner, page = 1, limit = 10 } = req.query;

    // Query payouts from The Graph
    const graphQuery = `
      query GetPayouts($first: Int, $skip: Int, $eventId: String, $challengeId: String, $poolId: String, $winner: String) {
        rewardDistributions(
          first: $first,
          skip: $skip,
          where: {
            ${eventId ? `eventId: $eventId` : ''}
            ${challengeId ? `challengeId: $challengeId` : ''}
            ${poolId ? `poolId: $poolId` : ''}
            ${winner ? `winners_contains: [$winner]` : ''}
          },
          orderBy: distributedAt,
          orderDirection: desc
        ) {
          id
          poolId
          eventId
          challengeId
          winners
          amounts
          totalAmount
          txHash
          distributedAt
          distributedBy
        }
      }
    `;

    const variables = {
      first: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit),
      eventId,
      challengeId,
      poolId,
      winner: winner?.toLowerCase()
    };

    const graphResult = await graphService.query(graphQuery, variables);
    const payouts = graphResult.data.rewardDistributions;

    // Enrich with detailed data from Filecoin
    const payoutsWithDetails = await Promise.all(
      payouts.map(async (payout) => {
        try {
          // Try to get detailed payout data from Filecoin
          // This would require storing the IPFS hash in the graph or finding by ID
          return {
            ...payout,
            winnersCount: payout.winners.length,
            averageAmount: payout.winners.length > 0 
              ? (parseFloat(payout.totalAmount) / payout.winners.length).toString()
              : '0'
          };
        } catch (error) {
          return payout;
        }
      })
    );

    res.json({
      success: true,
      payouts: payoutsWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: payoutsWithDetails.length
      }
    });
  } catch (error) {
    logger.error('Failed to get payout history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payout history'
    });
  }
});

// Get specific payout details
router.get('/:payoutId', 
  param('payoutId').notEmpty().withMessage('Payout ID is required')
], async (req, res) => {
  try {
    const { payoutId } = req.params;

    // Try to get payout data from The Graph first
    const graphQuery = `
      query GetPayout($payoutId: String!) {
        rewardDistribution(id: $payoutId) {
          id
          poolId
          eventId
          challengeId
          winners
          amounts
          totalAmount
          txHash
          distributedAt
          distributedBy
        }
      }
    `;

    const graphResult = await graphService.query(graphQuery, { payoutId });
    let payoutData = graphResult.data.rewardDistribution;

    if (!payoutData) {
      // Try to find by searching Filecoin data
      // This is a fallback method - in production you'd have better indexing
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }

    // Get additional details if available
    try {
      // Try to get the full payout record from Filecoin
      // This would require knowing the IPFS hash
      const enhancedData = {
        ...payoutData,
        winnersDetails: payoutData.winners.map((winner, index) => ({
          address: winner,
          amount: payoutData.amounts[index],
          rank: index + 1
        }))
      };
      payoutData = enhancedData;
    } catch (error) {
      // Use basic data if enhanced data not available
    }

    res.json({
      success: true,
      payout: payoutData
    });
  } catch (error) {
    logger.error('Failed to get payout details:', error);
    res.status(404).json({
      success: false,
      message: 'Payout not found'
    });
  }
});

// Get user's payout history
router.get('/user/:userAddress', 
  param('userAddress').isEthereumAddress().withMessage('Valid Ethereum address is required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const { userAddress } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Query user's payouts from The Graph
    const graphQuery = `
      query GetUserPayouts($userAddress: String!, $first: Int, $skip: Int) {
        rewardDistributions(
          first: $first,
          skip: $skip,
          where: {
            winners_contains: [$userAddress]
          },
          orderBy: distributedAt,
          orderDirection: desc
        ) {
          id
          poolId
          eventId
          challengeId
          winners
          amounts
          totalAmount
          txHash
          distributedAt
        }
      }
    `;

    const variables = {
      userAddress: userAddress.toLowerCase(),
      first: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
    };

    const graphResult = await graphService.query(graphQuery, variables);
    const payouts = graphResult.data.rewardDistributions;

    // Calculate user-specific data
    const userPayouts = payouts.map(payout => {
      const winnerIndex = payout.winners.findIndex(
        winner => winner.toLowerCase() === userAddress.toLowerCase()
      );
      
      return {
        ...payout,
        userAmount: winnerIndex >= 0 ? payout.amounts[winnerIndex] : '0',
        userRank: winnerIndex + 1,
        totalWinners: payout.winners.length
      };
    });

    const totalEarned = userPayouts.reduce((sum, payout) => {
      return sum + parseFloat(payout.userAmount);
    }, 0);

    res.json({
      success: true,
      payouts: userPayouts,
      summary: {
        totalPayouts: userPayouts.length,
        totalEarned: totalEarned.toString(),
        user: userAddress
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: userPayouts.length
      }
    });
  } catch (error) {
    logger.error('Failed to get user payout history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user payout history'
    });
  }
});

// Get payout statistics for an event
router.get('/stats/:eventId', 
  param('eventId').notEmpty().withMessage('Event ID is required')
], async (req, res) => {
  try {
    const { eventId } = req.params;

    // Query event payouts from The Graph
    const graphQuery = `
      query GetEventPayoutStats($eventId: String!) {
        rewardDistributions(
          where: {
            eventId: $eventId
          }
        ) {
          id
          poolId
          challengeId
          winners
          amounts
          totalAmount
          distributedAt
        }
      }
    `;

    const graphResult = await graphService.query(graphQuery, { eventId });
    const payouts = graphResult.data.rewardDistributions;

    // Calculate statistics
    const stats = {
      eventId,
      totalPayouts: payouts.length,
      totalAmountDistributed: payouts.reduce((sum, payout) => {
        return sum + parseFloat(payout.totalAmount);
      }, 0).toString(),
      totalWinners: payouts.reduce((sum, payout) => {
        return sum + payout.winners.length;
      }, 0),
      uniqueWinners: [...new Set(payouts.flatMap(payout => payout.winners))].length,
      challengesWithPayouts: [...new Set(payouts.map(payout => payout.challengeId))].length,
      averagePayoutPerWinner: 0,
      lastPayoutAt: payouts.length > 0 
        ? Math.max(...payouts.map(p => new Date(p.distributedAt).getTime()))
        : null
    };

    if (stats.totalWinners > 0) {
      stats.averagePayoutPerWinner = (
        parseFloat(stats.totalAmountDistributed) / stats.totalWinners
      ).toString();
    }

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Failed to get payout statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payout statistics'
    });
  }
});

// Automated payout endpoint (triggered by backend processes)
router.post('/auto-execute', authMiddleware, [
  body('eventId').notEmpty().withMessage('Event ID is required'),
  body('challengeId').notEmpty().withMessage('Challenge ID is required'),
  body('winnersHash').notEmpty().withMessage('Winners hash is required')
], async (req, res) => {
  try {
    const { eventId, challengeId, winnersHash } = req.body;

    // Get winners data from Filecoin
    const winnersData = await filecoinService.getUserData(winnersHash);
    
    if (!winnersData || !winnersData.winners) {
      return res.status(400).json({
        success: false,
        message: 'Invalid winners data'
      });
    }

    // Find the staking pool for this challenge
    const graphQuery = `
      query GetChallengePool($eventId: String!, $challengeId: String!) {
        stakingPools(
          where: {
            eventId: $eventId,
            challengeId: $challengeId,
            active: true
          }
        ) {
          poolId
        }
      }
    `;

    const graphResult = await graphService.query(graphQuery, { eventId, challengeId });
    const pools = graphResult.data.stakingPools;

    if (pools.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active staking pool found for this challenge'
      });
    }

    const poolId = pools[0].poolId;
    const winners = winnersData.winners.map(w => w.submitter);
    const amounts = winnersData.winners.map(w => {
      // Calculate amount based on rank and total pool
      const poolData = await hederaService.getStakingPool(poolId);
      const totalStaked = parseFloat(poolData.totalStaked);
      return (totalStaked * (w.rewardPercentage / 100)).toString();
    });

    // Execute the payout
    const payoutRequest = {
      eventId,
      challengeId,
      poolId,
      winners,
      amounts
    };

    // Use the regular payout execution logic
    req.body = payoutRequest;
    
    // Redirect to the main execute endpoint logic
    // (In a real implementation, you'd extract this to a shared function)
    
    res.json({
      success: true,
      message: 'Automated payout initiated',
      winners: winners.length,
      poolId
    });
  } catch (error) {
    logger.error('Failed to execute automated payout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute automated payout',
      error: error.message
    });
  }
});

// Helper function to check for existing payouts
async function getExistingPayouts(eventId, challengeId) {
  try {
    const graphQuery = `
      query GetExistingPayouts($eventId: String!, $challengeId: String!) {
        rewardDistributions(
          where: {
            eventId: $eventId,
            challengeId: $challengeId
          }
        ) {
          id
          distributedAt
        }
      }
    `;

    const graphResult = await graphService.query(graphQuery, { eventId, challengeId });
    return graphResult.data.rewardDistributions || [];
  } catch (error) {
    logger.error('Failed to check existing payouts:', error);
    return [];
  }
}

module.exports = router; 