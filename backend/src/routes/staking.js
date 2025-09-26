const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const hederaService = require('../services/hederaService');
const graphService = require('../services/graphService');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Create staking pool for a challenge
router.post('/pools', authMiddleware, [
  body('eventId').notEmpty().withMessage('Event ID is required'),
  body('challengeId').notEmpty().withMessage('Challenge ID is required'),
  body('stakeAmount').isFloat({ min: 0.001 }).withMessage('Stake amount must be at least 0.001'),
  body('tokenAddress').isEthereumAddress().withMessage('Valid token address is required')
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

    const { eventId, challengeId, stakeAmount, tokenAddress } = req.body;
    const creatorAddress = req.user.address;

    // Create staking pool on Hedera
    const result = await hederaService.createStakingPool(
      eventId,
      challengeId,
      stakeAmount,
      tokenAddress
    );

    logger.info(`Staking pool created: Pool ID ${result.poolId} for challenge ${challengeId}`);

    res.status(201).json({
      success: true,
      pool: {
        poolId: result.poolId,
        eventId,
        challengeId,
        stakeAmount,
        tokenAddress,
        creator: creatorAddress,
        txHash: result.txHash,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to create staking pool:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create staking pool',
      error: error.message
    });
  }
});

// Get all staking pools with filters
router.get('/pools', 
  query('eventId').optional().notEmpty().withMessage('Event ID cannot be empty'),
  query('challengeId').optional().notEmpty().withMessage('Challenge ID cannot be empty'),
  query('active').optional().isBoolean().withMessage('Active must be a boolean'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { eventId, challengeId, active, page = 1, limit = 10 } = req.query;

    // Query staking pools from The Graph
    const graphQuery = `
      query GetStakingPools($first: Int, $skip: Int, $eventId: String, $challengeId: String, $active: Boolean) {
        stakingPools(
          first: $first,
          skip: $skip,
          where: {
            ${eventId ? `eventId: $eventId` : ''}
            ${challengeId ? `challengeId: $challengeId` : ''}
            ${active !== undefined ? `active: $active` : ''}
          },
          orderBy: createdAt,
          orderDirection: desc
        ) {
          id
          poolId
          eventId
          challengeId
          stakeAmount
          totalStaked
          tokenAddress
          active
          creator
          createdAt
          participants {
            id
            user
            amount
            stakedAt
          }
        }
      }
    `;

    const variables = {
      first: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit),
      eventId,
      challengeId,
      active: active !== undefined ? active === 'true' : undefined
    };

    const graphResult = await graphService.query(graphQuery, variables);
    const pools = graphResult.data.stakingPools;

    // Enrich with real-time on-chain data
    const poolsWithCurrentData = await Promise.all(
      pools.map(async (pool) => {
        try {
          const onChainData = await hederaService.getStakingPool(pool.poolId);
          return {
            ...pool,
            currentData: onChainData,
            participantCount: pool.participants.length
          };
        } catch (error) {
          logger.error(`Failed to get on-chain data for pool ${pool.poolId}:`, error);
          return pool;
        }
      })
    );

    res.json({
      success: true,
      pools: poolsWithCurrentData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: poolsWithCurrentData.length
      }
    });
  } catch (error) {
    logger.error('Failed to get staking pools:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve staking pools'
    });
  }
});

// Get specific staking pool
router.get('/pools/:poolId', 
  param('poolId').isNumeric().withMessage('Pool ID must be numeric')
, async (req, res) => {
  try {
    const { poolId } = req.params;

    // Get pool data from Hedera
    const poolData = await hederaService.getStakingPool(poolId);

    // Get additional data from The Graph
    const graphQuery = `
      query GetStakingPool($poolId: String!) {
        stakingPool(id: $poolId) {
          id
          poolId
          eventId
          challengeId
          creator
          createdAt
          participants {
            id
            user
            amount
            stakedAt
          }
        }
      }
    `;

    const graphResult = await graphService.query(graphQuery, { poolId });
    const graphData = graphResult.data.stakingPool;

    const fullPoolData = {
      ...poolData,
      metadata: graphData,
      participantCount: graphData?.participants?.length || 0,
      participants: graphData?.participants || []
    };

    res.json({
      success: true,
      pool: fullPoolData
    });
  } catch (error) {
    logger.error('Failed to get staking pool:', error);
    res.status(404).json({
      success: false,
      message: 'Staking pool not found'
    });
  }
});

// Stake tokens in pool
router.post('/pools/:poolId/stake', authMiddleware, [
  param('poolId').isNumeric().withMessage('Pool ID must be numeric'),
  body('amount').isFloat({ min: 0.001 }).withMessage('Amount must be at least 0.001')
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

    const { poolId } = req.params;
    const { amount } = req.body;
    const userAddress = req.user.address;

    // Get pool info to validate
    const poolData = await hederaService.getStakingPool(poolId);
    
    if (!poolData.active) {
      return res.status(400).json({
        success: false,
        message: 'Staking pool is not active'
      });
    }

    // Check if amount matches required stake amount
    if (parseFloat(amount) !== parseFloat(poolData.stakeAmount)) {
      return res.status(400).json({
        success: false,
        message: `Stake amount must be exactly ${poolData.stakeAmount} tokens`
      });
    }

    // Check if user has already staked
    const userStake = await hederaService.getUserStake(poolId, userAddress);
    if (parseFloat(userStake) > 0) {
      return res.status(400).json({
        success: false,
        message: 'User has already staked in this pool'
      });
    }

    // Execute staking transaction
    const result = await hederaService.stakeTokens(poolId, amount, userAddress);

    logger.info(`User ${userAddress} staked ${amount} tokens in pool ${poolId}`);

    res.json({
      success: true,
      stake: {
        poolId,
        amount,
        userAddress,
        txHash: result.txHash,
        stakedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to stake tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stake tokens',
      error: error.message
    });
  }
});

// Unstake tokens from pool
router.post('/pools/:poolId/unstake', authMiddleware, 
  param('poolId').isNumeric().withMessage('Pool ID must be numeric')
, async (req, res) => {
  try {
    const { poolId } = req.params;
    const userAddress = req.user.address;

    // Check user's stake
    const userStake = await hederaService.getUserStake(poolId, userAddress);
    if (parseFloat(userStake) === 0) {
      return res.status(400).json({
        success: false,
        message: 'No stake found for this user in the pool'
      });
    }

    // Get pool data to check if unstaking is allowed
    const poolData = await hederaService.getStakingPool(poolId);
    
    // Check if challenge is completed (simplified check)
    // In a real implementation, you'd check challenge status and timing
    
    // Execute unstaking transaction
    const result = await hederaService.unstakeTokens(poolId, userAddress);

    logger.info(`User ${userAddress} unstaked ${userStake} tokens from pool ${poolId}`);

    res.json({
      success: true,
      unstake: {
        poolId,
        amount: userStake,
        userAddress,
        txHash: result.txHash,
        unstakedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to unstake tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unstake tokens',
      error: error.message
    });
  }
});

// Get user's stakes across all pools
router.get('/user/:userAddress/stakes', 
  param('userAddress').isEthereumAddress().withMessage('Valid Ethereum address is required'),
  query('active').optional().isBoolean().withMessage('Active must be a boolean')
, async (req, res) => {
  try {
    const { userAddress } = req.params;
    const { active } = req.query;

    // Query user stakes from The Graph
    const graphQuery = `
      query GetUserStakes($userAddress: String!, $active: Boolean) {
        user(id: $userAddress) {
          stakes(
            where: {
              ${active !== undefined ? `pool_: { active: $active }` : ''}
            }
          ) {
            id
            amount
            stakedAt
            pool {
              id
              poolId
              eventId
              challengeId
              stakeAmount
              tokenAddress
              active
            }
          }
        }
      }
    `;

    const variables = {
      userAddress: userAddress.toLowerCase(),
      active: active !== undefined ? active === 'true' : undefined
    };

    const graphResult = await graphService.query(graphQuery, variables);
    const userStakes = graphResult.data.user?.stakes || ];

    // Enrich with current on-chain data
    const stakesWithCurrentData = await Promise.all(
      userStakes.map(async (stake) => {
        try {
          const currentStake = await hederaService.getUserStake(stake.pool.poolId, userAddress);
          return {
            ...stake,
            currentAmount: currentStake
          };
        } catch (error) {
          logger.error(`Failed to get current stake for pool ${stake.pool.poolId}:`, error);
          return stake;
        }
      })
    );

    const totalStaked = stakesWithCurrentData.reduce((sum, stake) => {
      return sum + parseFloat(stake.currentAmount || stake.amount);
    }, 0);

    res.json({
      success: true,
      stakes: stakesWithCurrentData,
      summary: {
        totalStakes: stakesWithCurrentData.length,
        totalStaked: totalStaked.toString(),
        activeStakes: stakesWithCurrentData.filter(s => s.pool.active).length
      }
    });
  } catch (error) {
    logger.error('Failed to get user stakes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user stakes'
    });
  }
});

// Distribute rewards (admin only)
router.post('/pools/:poolId/distribute', authMiddleware, 
  param('poolId').isNumeric().withMessage('Pool ID must be numeric'),
  body('winners').isArray().withMessage('Winners array is required'),
  body('amounts').isArray().withMessage('Amounts array is required'),
, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { poolId } = req.params;
    const { winners, amounts } = req.body;
    const adminAddress = req.user.address;

    // Validate arrays
    if (winners.length !== amounts.length) {
      return res.status(400).json({
        success: false,
        message: 'Winners and amounts arrays must have the same length'
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

    // Get pool data
    const poolData = await hederaService.getStakingPool(poolId);
    if (!poolData.active) {
      return res.status(400).json({
        success: false,
        message: 'Cannot distribute rewards for inactive pool'
      });
    }

    // Execute reward distribution
    const result = await hederaService.distributeRewards(poolId, winners, amounts);

    logger.info(`Rewards distributed for pool ${poolId} to ${winners.length} winners`);

    res.json({
      success: true,
      distribution: {
        poolId,
        winners,
        amounts,
        txHash: result.txHash,
        distributedAt: new Date().toISOString(),
        distributedBy: adminAddress
      }
    });
  } catch (error) {
    logger.error('Failed to distribute rewards:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to distribute rewards',
      error: error.message
    });
  }
});

// Get pool statistics
router.get('/pools/:poolId/stats', 
  param('poolId').isNumeric().withMessage('Pool ID must be numeric')
, async (req, res) => {
  try {
    const { poolId } = req.params;

    // Get current pool data
    const poolData = await hederaService.getStakingPool(poolId);

    // Get detailed stats from The Graph
    const graphQuery = `
      query GetPoolStats($poolId: String!) {
        stakingPool(id: $poolId) {
          id
          totalStaked
          participants {
            id
            amount
            stakedAt
          }
          rewardDistributions {
            id
            winners
            amounts
            distributedAt
            txHash
          }
        }
      }
    `;

    const graphResult = await graphService.query(graphQuery, { poolId });
    const graphData = graphResult.data.stakingPool;

    if (!graphData) {
      return res.status(404).json({
        success: false,
        message: 'Pool not found'
      });
    }

    const stats = {
      poolId,
      basic: poolData,
      participants: {
        count: graphData.participants.length,
        totalStaked: graphData.totalStaked,
        averageStake: graphData.participants.length > 0 
          ? (parseFloat(graphData.totalStaked) / graphData.participants.length).toString()
          : '0'
      },
      rewards: {
        distributionCount: graphData.rewardDistributions.length,
        totalDistributed: graphData.rewardDistributions.reduce((sum, dist) => {
          return sum + dist.amounts.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
        }, 0).toString(),
        lastDistribution: graphData.rewardDistributions0] || null
      }
    };

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Failed to get pool statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pool statistics'
    });
  }
});

module.exports = router; 