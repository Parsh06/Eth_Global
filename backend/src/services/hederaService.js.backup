const { ethers } = require('ethers');
const {
  Client,
  AccountId,
  PrivateKey,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TransferTransaction,
  AccountCreateTransaction,
  Hbar
} = require('@hashgraph/sdk');
const logger = require('../utils/logger');

class HederaService {
  constructor() {
    this.networkType = process.env.HEDERA_NETWORK || 'testnet';
    this.accountId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
    this.privateKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY);
    this.evmRpcUrl = process.env.HEDERA_EVM_RPC_URL;
    
    // Initialize Hedera client
    this.client = Client.forTestnet();
    this.client.setOperator(this.accountId, this.privateKey);
    
    // Initialize EVM provider
    this.provider = new ethers.JsonRpcProvider(this.evmRpcUrl);
    this.wallet = new ethers.Wallet(process.env.HEDERA_PRIVATE_KEY, this.provider);
    
    // Contract ABIs and addresses
    this.contractAddresses = {
      eventGameHub: process.env.EVENT_GAME_HUB_CONTRACT,
      stakingEscrow: process.env.STAKING_ESCROW_CONTRACT,
      challengeVerifier: process.env.CHALLENGE_VERIFIER_CONTRACT,
      htsIntegration: process.env.HTS_INTEGRATION_CONTRACT
    };
    
    this.initializeContracts();
  }

  // Initialize smart contract instances
  initializeContracts() {
    const eventGameHubABI = [
      "function createEvent(string memory name, string memory ipfsHash, uint256 startTime, uint256 endTime) external returns (uint256)",
      "function getEvent(uint256 eventId) external view returns (tuple(string name, string ipfsHash, uint256 startTime, uint256 endTime, bool active))",
      "function joinEvent(uint256 eventId, address participant) external",
      "function getEventParticipants(uint256 eventId) external view returns (address[])",
      "event EventCreated(uint256 indexed eventId, string name, string ipfsHash, uint256 startTime, uint256 endTime)",
      "event ParticipantJoined(uint256 indexed eventId, address indexed participant)"
    ];

    const stakingEscrowABI = [
      "function createStakingPool(uint256 eventId, uint256 challengeId, uint256 stakeAmount, address tokenAddress) external returns (uint256)",
      "function stake(uint256 poolId, uint256 amount) external",
      "function unstake(uint256 poolId) external",
      "function distributeRewards(uint256 poolId, address[] memory winners, uint256[] memory amounts) external",
      "function getStakingPool(uint256 poolId) external view returns (tuple(uint256 eventId, uint256 challengeId, uint256 totalStaked, uint256 stakeAmount, address tokenAddress, bool active))",
      "function getUserStake(uint256 poolId, address user) external view returns (uint256)",
      "event StakingPoolCreated(uint256 indexed poolId, uint256 indexed eventId, uint256 indexed challengeId, uint256 stakeAmount)",
      "event UserStaked(uint256 indexed poolId, address indexed user, uint256 amount)",
      "event RewardsDistributed(uint256 indexed poolId, address[] winners, uint256[] amounts)"
    ];

    const challengeVerifierABI = [
      "function submitChallenge(uint256 eventId, uint256 challengeId, string memory proofHash, bytes memory submissionData) external",
      "function verifyChallenge(uint256 submissionId, bool isValid, uint256 score) external",
      "function getChallengeSubmission(uint256 submissionId) external view returns (tuple(uint256 eventId, uint256 challengeId, address submitter, string proofHash, bool verified, uint256 score, uint256 timestamp))",
      "function getEventChallengeSubmissions(uint256 eventId, uint256 challengeId) external view returns (uint256[])",
      "event ChallengeSubmitted(uint256 indexed submissionId, uint256 indexed eventId, uint256 indexed challengeId, address submitter)",
      "event ChallengeVerified(uint256 indexed submissionId, bool isValid, uint256 score)"
    ];

    if (this.contractAddresses.eventGameHub) {
      this.eventGameHubContract = new ethers.Contract(
        this.contractAddresses.eventGameHub,
        eventGameHubABI,
        this.wallet
      );
    }

    if (this.contractAddresses.stakingEscrow) {
      this.stakingEscrowContract = new ethers.Contract(
        this.contractAddresses.stakingEscrow,
        stakingEscrowABI,
        this.wallet
      );
    }

    if (this.contractAddresses.challengeVerifier) {
      this.challengeVerifierContract = new ethers.Contract(
        this.contractAddresses.challengeVerifier,
        challengeVerifierABI,
        this.wallet
      );
    }
  }

  // Create event on-chain
  async createEvent(eventData) {
    try {
      if (!this.eventGameHubContract) {
        throw new Error('EventGameHub contract not initialized');
      }

      const tx = await this.eventGameHubContract.createEvent(
        eventData.name,
        eventData.ipfsHash,
        Math.floor(new Date(eventData.startDate).getTime() / 1000),
        Math.floor(new Date(eventData.endDate).getTime() / 1000)
      );

      const receipt = await tx.wait();
      const eventCreatedLog = receipt.logs.find(log => 
        log.topics[0] === ethers.id('EventCreated(uint256,string,string,uint256,uint256)')
      );

      if (eventCreatedLog) {
        const eventId = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], eventCreatedLog.data)[0];
        logger.info(`Event created on-chain with ID: ${eventId}`);
        return { eventId: eventId.toString(), txHash: tx.hash };
      }

      throw new Error('Event creation failed - no event ID returned');
    } catch (error) {
      logger.error('Failed to create event on-chain:', error);
      throw error;
    }
  }

  // Create staking pool for challenge
  async createStakingPool(eventId, challengeId, stakeAmount, tokenAddress) {
    try {
      if (!this.stakingEscrowContract) {
        throw new Error('StakingEscrow contract not initialized');
      }

      const tx = await this.stakingEscrowContract.createStakingPool(
        eventId,
        challengeId,
        ethers.parseUnits(stakeAmount.toString(), 18),
        tokenAddress
      );

      const receipt = await tx.wait();
      const poolCreatedLog = receipt.logs.find(log =>
        log.topics[0] === ethers.id('StakingPoolCreated(uint256,uint256,uint256,uint256)')
      );

      if (poolCreatedLog) {
        const poolId = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], poolCreatedLog.data)[0];
        logger.info(`Staking pool created with ID: ${poolId}`);
        return { poolId: poolId.toString(), txHash: tx.hash };
      }

      throw new Error('Staking pool creation failed');
    } catch (error) {
      logger.error('Failed to create staking pool:', error);
      throw error;
    }
  }

  // Stake tokens in pool
  async stakeTokens(poolId, amount, userAddress) {
    try {
      if (!this.stakingEscrowContract) {
        throw new Error('StakingEscrow contract not initialized');
      }

      // For backend operations, we use the operator wallet
      // In production, this would be called by the user's wallet
      const tx = await this.stakingEscrowContract.stake(
        poolId,
        ethers.parseUnits(amount.toString(), 18)
      );

      const receipt = await tx.wait();
      logger.info(`Tokens staked successfully: Pool ${poolId}, Amount: ${amount}`);
      
      return { 
        success: true, 
        txHash: tx.hash,
        poolId,
        amount,
        userAddress
      };
    } catch (error) {
      logger.error('Failed to stake tokens:', error);
      throw error;
    }
  }

  // Submit challenge on-chain
  async submitChallenge(eventId, challengeId, proofHash, submissionData, submitterAddress) {
    try {
      if (!this.challengeVerifierContract) {
        throw new Error('ChallengeVerifier contract not initialized');
      }

      const tx = await this.challengeVerifierContract.submitChallenge(
        eventId,
        challengeId,
        proofHash,
        ethers.toUtf8Bytes(JSON.stringify(submissionData))
      );

      const receipt = await tx.wait();
      const submissionLog = receipt.logs.find(log =>
        log.topics[0] === ethers.id('ChallengeSubmitted(uint256,uint256,uint256,address)')
      );

      if (submissionLog) {
        const submissionId = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], submissionLog.data)[0];
        logger.info(`Challenge submitted with ID: ${submissionId}`);
        return { submissionId: submissionId.toString(), txHash: tx.hash };
      }

      throw new Error('Challenge submission failed');
    } catch (error) {
      logger.error('Failed to submit challenge:', error);
      throw error;
    }
  }

  // Verify challenge and update on-chain
  async verifyChallenge(submissionId, isValid, score) {
    try {
      if (!this.challengeVerifierContract) {
        throw new Error('ChallengeVerifier contract not initialized');
      }

      const tx = await this.challengeVerifierContract.verifyChallenge(
        submissionId,
        isValid,
        score
      );

      const receipt = await tx.wait();
      logger.info(`Challenge verified: Submission ${submissionId}, Valid: ${isValid}, Score: ${score}`);
      
      return { 
        success: true, 
        txHash: tx.hash,
        submissionId,
        isValid,
        score
      };
    } catch (error) {
      logger.error('Failed to verify challenge:', error);
      throw error;
    }
  }

  // Distribute rewards to winners
  async distributeRewards(poolId, winners, amounts) {
    try {
      if (!this.stakingEscrowContract) {
        throw new Error('StakingEscrow contract not initialized');
      }

      const parsedAmounts = amounts.map(amount => ethers.parseUnits(amount.toString(), 18));

      const tx = await this.stakingEscrowContract.distributeRewards(
        poolId,
        winners,
        parsedAmounts
      );

      const receipt = await tx.wait();
      logger.info(`Rewards distributed for pool ${poolId} to ${winners.length} winners`);
      
      return { 
        success: true, 
        txHash: tx.hash,
        poolId,
        winners,
        amounts
      };
    } catch (error) {
      logger.error('Failed to distribute rewards:', error);
      throw error;
    }
  }

  // Create HTS token
  async createHTSToken(tokenName, tokenSymbol, initialSupply, treasuryAccountId) {
    try {
      const tokenCreateTx = new TokenCreateTransaction()
        .setTokenName(tokenName)
        .setTokenSymbol(tokenSymbol)
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Finite)
        .setInitialSupply(initialSupply)
        .setMaxSupply(initialSupply * 10)
        .setTreasuryAccountId(treasuryAccountId || this.accountId)
        .setAdminKey(this.privateKey)
        .setSupplyKey(this.privateKey)
        .setFreezeDefault(false);

      const tokenCreateSubmit = await tokenCreateTx.execute(this.client);
      const tokenCreateReceipt = await tokenCreateSubmit.getReceipt(this.client);
      const tokenId = tokenCreateReceipt.tokenId;

      logger.info(`HTS Token created: ${tokenId}`);
      
      return {
        success: true,
        tokenId: tokenId.toString(),
        tokenName,
        tokenSymbol,
        initialSupply
      };
    } catch (error) {
      logger.error('Failed to create HTS token:', error);
      throw error;
    }
  }

  // Transfer HTS tokens
  async transferHTSTokens(tokenId, fromAccountId, toAccountId, amount) {
    try {
      const transferTx = new TransferTransaction()
        .addTokenTransfer(tokenId, fromAccountId, -amount)
        .addTokenTransfer(tokenId, toAccountId, amount);

      const transferSubmit = await transferTx.execute(this.client);
      const transferReceipt = await transferSubmit.getReceipt(this.client);

      logger.info(`HTS Token transfer completed: ${amount} tokens from ${fromAccountId} to ${toAccountId}`);
      
      return {
        success: true,
        txId: transferSubmit.transactionId.toString(),
        status: transferReceipt.status.toString()
      };
    } catch (error) {
      logger.error('Failed to transfer HTS tokens:', error);
      throw error;
    }
  }

  // Get on-chain event data
  async getEvent(eventId) {
    try {
      if (!this.eventGameHubContract) {
        throw new Error('EventGameHub contract not initialized');
      }

      const event = await this.eventGameHubContract.getEvent(eventId);
      return {
        name: event.name,
        ipfsHash: event.ipfsHash,
        startTime: Number(event.startTime),
        endTime: Number(event.endTime),
        active: event.active
      };
    } catch (error) {
      logger.error('Failed to get event data:', error);
      throw error;
    }
  }

  // Get staking pool data
  async getStakingPool(poolId) {
    try {
      if (!this.stakingEscrowContract) {
        throw new Error('StakingEscrow contract not initialized');
      }

      const pool = await this.stakingEscrowContract.getStakingPool(poolId);
      return {
        eventId: Number(pool.eventId),
        challengeId: Number(pool.challengeId),
        totalStaked: ethers.formatUnits(pool.totalStaked, 18),
        stakeAmount: ethers.formatUnits(pool.stakeAmount, 18),
        tokenAddress: pool.tokenAddress,
        active: pool.active
      };
    } catch (error) {
      logger.error('Failed to get staking pool data:', error);
      throw error;
    }
  }

  // Get user stake amount
  async getUserStake(poolId, userAddress) {
    try {
      if (!this.stakingEscrowContract) {
        throw new Error('StakingEscrow contract not initialized');
      }

      const stake = await this.stakingEscrowContract.getUserStake(poolId, userAddress);
      return ethers.formatUnits(stake, 18);
    } catch (error) {
      logger.error('Failed to get user stake:', error);
      throw error;
    }
  }

  // Get challenge submission data
  async getChallengeSubmission(submissionId) {
    try {
      if (!this.challengeVerifierContract) {
        throw new Error('ChallengeVerifier contract not initialized');
      }

      const submission = await this.challengeVerifierContract.getChallengeSubmission(submissionId);
      return {
        eventId: Number(submission.eventId),
        challengeId: Number(submission.challengeId),
        submitter: submission.submitter,
        proofHash: submission.proofHash,
        verified: submission.verified,
        score: Number(submission.score),
        timestamp: Number(submission.timestamp)
      };
    } catch (error) {
      logger.error('Failed to get challenge submission:', error);
      throw error;
    }
  }
}

module.exports = new HederaService(); 