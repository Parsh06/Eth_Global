const { GraphQLClient } = require('graphql-request');
const logger = require('../utils/logger');

class GraphService {
  constructor() {
    this.endpoint = process.env.GRAPH_ENDPOINT;
    this.apiKey = process.env.GRAPH_API_KEY;
    this.client = new GraphQLClient(this.endpoint, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    });
  }

  // Query all events
  async getEvents(filters = {}) {
    const query = `
      query GetEvents($first: Int, $skip: Int, $where: Event_filter) {
        events(first: $first, skip: $skip, where: $where, orderBy: createdAt, orderDirection: desc) {
          id
          eventId
          creator
          stakeAmount
          active
          metadataUri
          createdAt
          updatedAt
          participants {
            id
            user
            joinedAt
            stakeAmount
          }
          challenges {
            id
            challengeId
            totalStaked
            participantCount
            active
          }
        }
      }
    `;

    try {
      const variables = {
        first: filters.limit || 10,
        skip: filters.offset || 0,
        where: this.buildEventFilter(filters)
      };

      const data = await this.client.request(query, variables);
      
      logger.info(`Retrieved ${data.events.length} events from The Graph`);
      
      return {
        success: true,
        events: data.events,
        count: data.events.length
      };
    } catch (error) {
      logger.error('Failed to query events from The Graph:', error);
      throw error;
    }
  }

  // Query specific event
  async getEvent(eventId) {
    const query = `
      query GetEvent($eventId: String!) {
        events(where: { eventId: $eventId }) {
          id
          eventId
          creator
          stakeAmount
          active
          metadataUri
          createdAt
          updatedAt
          participants {
            id
            user
            joinedAt
            stakeAmount
          }
          challenges {
            id
            challengeId
            totalStaked
            participantCount
            active
            submissions {
              id
              user
              proofUri
              verified
              success
              timestamp
            }
          }
        }
      }
    `;

    try {
      const data = await this.client.request(query, { eventId });
      
      if (data.events.length === 0) {
        return {
          success: false,
          error: 'Event not found'
        };
      }

      logger.info(`Retrieved event ${eventId} from The Graph`);
      
      return {
        success: true,
        event: data.events[0]
      };
    } catch (error) {
      logger.error('Failed to query event from The Graph:', error);
      throw error;
    }
  }

  // Query staking data
  async getStakingData(filters = {}) {
    const query = `
      query GetStakingData($first: Int, $skip: Int, $where: Stake_filter) {
        stakes(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: desc) {
          id
          user
          challengeId
          amount
          timestamp
          active
          challenge {
            id
            challengeId
            totalStaked
            participantCount
          }
        }
      }
    `;

    try {
      const variables = {
        first: filters.limit || 50,
        skip: filters.offset || 0,
        where: this.buildStakeFilter(filters)
      };

      const data = await this.client.request(query, variables);
      
      logger.info(`Retrieved ${data.stakes.length} stakes from The Graph`);
      
      return {
        success: true,
        stakes: data.stakes,
        count: data.stakes.length
      };
    } catch (error) {
      logger.error('Failed to query staking data from The Graph:', error);
      throw error;
    }
  }

  // Query user's staking activity
  async getUserStakes(userAddress, filters = {}) {
    const query = `
      query GetUserStakes($user: String!, $first: Int, $skip: Int, $where: Stake_filter) {
        stakes(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: desc) {
          id
          user
          challengeId
          amount
          timestamp
          active
          challenge {
            id
            challengeId
            totalStaked
            participantCount
            event {
              eventId
              metadataUri
            }
          }
        }
      }
    `;

    try {
      const whereClause = {
        user: userAddress.toLowerCase(),
        ...this.buildStakeFilter(filters)
      };

      const variables = {
        user: userAddress.toLowerCase(),
        first: filters.limit || 20,
        skip: filters.offset || 0,
        where: whereClause
      };

      const data = await this.client.request(query, variables);
      
      logger.info(`Retrieved ${data.stakes.length} stakes for user ${userAddress}`);
      
      return {
        success: true,
        stakes: data.stakes,
        user: userAddress,
        count: data.stakes.length
      };
    } catch (error) {
      logger.error('Failed to query user stakes from The Graph:', error);
      throw error;
    }
  }

  // Query challenge submissions
  async getChallengeSubmissions(challengeId, filters = {}) {
    const query = `
      query GetChallengeSubmissions($challengeId: String!, $first: Int, $skip: Int) {
        challengeSubmissions(
          first: $first, 
          skip: $skip, 
          where: { challengeId: $challengeId }, 
          orderBy: timestamp, 
          orderDirection: desc
        ) {
          id
          user
          challengeId
          proofUri
          verified
          success
          timestamp
          verifiedAt
          challenge {
            id
            totalStaked
            participantCount
          }
        }
      }
    `;

    try {
      const variables = {
        challengeId,
        first: filters.limit || 50,
        skip: filters.offset || 0
      };

      const data = await this.client.request(query, variables);
      
      logger.info(`Retrieved ${data.challengeSubmissions.length} submissions for challenge ${challengeId}`);
      
      return {
        success: true,
        submissions: data.challengeSubmissions,
        challengeId,
        count: data.challengeSubmissions.length
      };
    } catch (error) {
      logger.error('Failed to query challenge submissions from The Graph:', error);
      throw error;
    }
  }

  // Query payout transactions
  async getPayouts(filters = {}) {
    const query = `
      query GetPayouts($first: Int, $skip: Int, $where: Payout_filter) {
        payouts(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: desc) {
          id
          user
          challengeId
          amount
          timestamp
          transactionHash
          challenge {
            id
            challengeId
            event {
              eventId
              metadataUri
            }
          }
        }
      }
    `;

    try {
      const variables = {
        first: filters.limit || 50,
        skip: filters.offset || 0,
        where: this.buildPayoutFilter(filters)
      };

      const data = await this.client.request(query, variables);
      
      logger.info(`Retrieved ${data.payouts.length} payouts from The Graph`);
      
      return {
        success: true,
        payouts: data.payouts,
        count: data.payouts.length
      };
    } catch (error) {
      logger.error('Failed to query payouts from The Graph:', error);
      throw error;
    }
  }

  // Query user activity summary
  async getUserActivitySummary(userAddress) {
    const query = `
      query GetUserActivity($user: String!) {
        user(id: $user) {
          id
          totalStaked
          totalEarned
          eventsJoined
          challengesCompleted
          successfulChallenges
          stakes {
            id
            amount
            challengeId
            active
          }
          submissions {
            id
            challengeId
            verified
            success
          }
          payouts {
            id
            amount
            challengeId
          }
        }
      }
    `;

    try {
      const data = await this.client.request(query, { user: userAddress.toLowerCase() });
      
      if (!data.user) {
        return {
          success: false,
          error: 'User not found'
        };
      }

      logger.info(`Retrieved activity summary for user ${userAddress}`);
      
      return {
        success: true,
        user: data.user
      };
    } catch (error) {
      logger.error('Failed to query user activity from The Graph:', error);
      throw error;
    }
  }

  // Query real-time statistics
  async getStatistics() {
    const query = `
      query GetStatistics {
        eventStats: events(first: 1000) {
          id
          stakeAmount
          participants {
            id
          }
        }
        challengeStats: challenges(first: 1000) {
          id
          totalStaked
          participantCount
        }
        totalStaked: stakes(first: 1000) {
          amount
        }
        totalPayouts: payouts(first: 1000) {
          amount
        }
      }
    `;

    try {
      const data = await this.client.request(query);
      
      const stats = {
        totalEvents: data.eventStats.length,
        totalChallenges: data.challengeStats.length,
        totalParticipants: new Set(
          data.eventStats.flatMap(event => 
            event.participants.map(p => p.id)
          )
        ).size,
        totalStaked: data.totalStaked.reduce((sum, stake) => 
          sum + parseFloat(stake.amount), 0
        ),
        totalPayouts: data.totalPayouts.reduce((sum, payout) => 
          sum + parseFloat(payout.amount), 0
        ),
        averageStakePerChallenge: data.challengeStats.length > 0 
          ? data.challengeStats.reduce((sum, challenge) => 
              sum + parseFloat(challenge.totalStaked), 0
            ) / data.challengeStats.length 
          : 0
      };

      logger.info('Retrieved platform statistics from The Graph');
      
      return {
        success: true,
        statistics: stats
      };
    } catch (error) {
      logger.error('Failed to query statistics from The Graph:', error);
      throw error;
    }
  }

  // Helper methods to build GraphQL filters
  buildEventFilter(filters) {
    const where = {};
    
    if (filters.active !== undefined) {
      where.active = filters.active;
    }
    
    if (filters.creator) {
      where.creator = filters.creator.toLowerCase();
    }
    
    if (filters.minStake) {
      where.stakeAmount_gte = filters.minStake;
    }
    
    if (filters.maxStake) {
      where.stakeAmount_lte = filters.maxStake;
    }
    
    return where;
  }

  buildStakeFilter(filters) {
    const where = {};
    
    if (filters.user) {
      where.user = filters.user.toLowerCase();
    }
    
    if (filters.challengeId) {
      where.challengeId = filters.challengeId;
    }
    
    if (filters.active !== undefined) {
      where.active = filters.active;
    }
    
    if (filters.minAmount) {
      where.amount_gte = filters.minAmount;
    }
    
    return where;
  }

  buildPayoutFilter(filters) {
    const where = {};
    
    if (filters.user) {
      where.user = filters.user.toLowerCase();
    }
    
    if (filters.challengeId) {
      where.challengeId = filters.challengeId;
    }
    
    if (filters.minAmount) {
      where.amount_gte = filters.minAmount;
    }
    
    return where;
  }
}

module.exports = new GraphService(); 