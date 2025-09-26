const { OpenAI } = require('openai');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = process.env.AI_MODEL || 'gpt-4';
  }

  // Verify challenge submission using AI
  async verifyChallenge(challengeData, submissionData, challengeType) {
    try {
      const verificationPrompt = this.buildVerificationPrompt(
        challengeData,
        submissionData,
        challengeType
      );

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are an AI judge for a decentralized gaming platform. Your role is to fairly evaluate challenge submissions and provide objective scoring. Always respond with a JSON object containing: isValid (boolean), score (0-100), reasoning (string), and confidence (0-1).`
          },
          {
            role: 'user',
            content: verificationPrompt
          }
        ],
        temperature: 0.1, // Low temperature for consistent results
        max_tokens: 500
      });

      const aiResponse = response.choices[0].message.content;
      const verification = JSON.parse(aiResponse);

      logger.info(`AI verification completed: ${JSON.stringify(verification)}`);

      return {
        isValid: verification.isValid,
        score: Math.max(0, Math.min(100, verification.score)), // Ensure score is 0-100
        reasoning: verification.reasoning,
        confidence: verification.confidence,
        aiModel: this.model,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('AI verification failed:', error);
      throw new Error(`AI verification failed: ${error.message}`);
    }
  }

  // Build verification prompt based on challenge type
  buildVerificationPrompt(challengeData, submissionData, challengeType) {
    const basePrompt = `
CHALLENGE VERIFICATION REQUEST

Challenge Details:
- Title: ${challengeData.title}
- Description: ${challengeData.description}
- Type: ${challengeType}
- Requirements: ${JSON.stringify(challengeData.requirements, null, 2)}
- Scoring Criteria: ${JSON.stringify(challengeData.scoringCriteria, null, 2)}

Submission Data:
- Submitter: ${submissionData.submitter}
- Submission Time: ${submissionData.timestamp}
- Content: ${JSON.stringify(submissionData.content, null, 2)}
- Proof Hash: ${submissionData.proofHash}
`;

    switch (challengeType) {
      case 'photo':
        return basePrompt + this.buildPhotoVerificationPrompt(challengeData, submissionData);
      case 'quiz':
        return basePrompt + this.buildQuizVerificationPrompt(challengeData, submissionData);
      case 'location':
        return basePrompt + this.buildLocationVerificationPrompt(challengeData, submissionData);
      case 'creative':
        return basePrompt + this.buildCreativeVerificationPrompt(challengeData, submissionData);
      case 'skill':
        return basePrompt + this.buildSkillVerificationPrompt(challengeData, submissionData);
      default:
        return basePrompt + this.buildGenericVerificationPrompt(challengeData, submissionData);
    }
  }

  buildPhotoVerificationPrompt(challengeData, submissionData) {
    return `
PHOTO CHALLENGE VERIFICATION

Additional Context:
- Photo metadata: ${JSON.stringify(submissionData.metadata, null, 2)}
- Location data: ${submissionData.location ? JSON.stringify(submissionData.location) : 'N/A'}
- Required elements: ${challengeData.requiredElements || 'N/A'}

Please verify:
1. Does the photo meet the challenge requirements?
2. Is the photo authentic (not AI-generated or heavily manipulated)?
3. Does it contain all required elements?
4. Quality and creativity score (0-100)

Provide your assessment as a JSON object.`;
  }

  buildQuizVerificationPrompt(challengeData, submissionData) {
    return `
QUIZ CHALLENGE VERIFICATION

Quiz Questions and Answers:
${challengeData.questions.map((q, i) => `
Question ${i + 1}: ${q.question}
Correct Answer: ${q.correctAnswer}
Submitted Answer: ${submissionData.answers[i]}
Points: ${q.points}
`).join('')}

Please verify:
1. Calculate the total score based on correct answers
2. Check for any potential cheating indicators
3. Verify submission time against time limits
4. Assess overall performance

Provide scoring and validation as a JSON object.`;
  }

  buildLocationVerificationPrompt(challengeData, submissionData) {
    return `
LOCATION CHALLENGE VERIFICATION

Target Location: ${challengeData.targetLocation}
Required Radius: ${challengeData.radiusMeters} meters
Submitted Location: ${JSON.stringify(submissionData.location)}
Timestamp: ${submissionData.locationTimestamp}

Please verify:
1. Is the submitted location within the required radius?
2. Is the timestamp reasonable (not spoofed)?
3. Calculate distance from target location
4. Assess location accuracy and validity

Provide verification and distance calculation as a JSON object.`;
  }

  buildCreativeVerificationPrompt(challengeData, submissionData) {
    return `
CREATIVE CHALLENGE VERIFICATION

Creative Work Details:
- Medium: ${challengeData.medium}
- Theme: ${challengeData.theme}
- Submitted work: ${JSON.stringify(submissionData.creativeWork)}
- Description: ${submissionData.description}

Please evaluate:
1. Originality and creativity (0-100)
2. Adherence to theme and requirements
3. Technical execution quality
4. Overall artistic merit
5. Appropriateness of content

Provide creative assessment as a JSON object.`;
  }

  buildSkillVerificationPrompt(challengeData, submissionData) {
    return `
SKILL CHALLENGE VERIFICATION

Skill Challenge Details:
- Skill type: ${challengeData.skillType}
- Difficulty level: ${challengeData.difficulty}
- Success criteria: ${JSON.stringify(challengeData.successCriteria)}
- Submitted proof: ${JSON.stringify(submissionData.skillProof)}

Please verify:
1. Does the submission demonstrate the required skill?
2. Meet the minimum success criteria?
3. Rate skill level demonstrated (0-100)
4. Verify authenticity of the performance

Provide skill assessment as a JSON object.`;
  }

  buildGenericVerificationPrompt(challengeData, submissionData) {
    return `
GENERIC CHALLENGE VERIFICATION

Please evaluate this submission based on:
1. Completion of requirements
2. Quality of submission
3. Adherence to rules
4. Timestamp validity
5. Overall merit

Provide your assessment as a JSON object with the required fields.`;
  }

  // Determine winners from multiple submissions
  async determineWinners(submissions, maxWinners = 3) {
    try {
      // Filter valid submissions and sort by score
      const validSubmissions = submissions
        .filter(sub => sub.verification && sub.verification.isValid)
        .sort((a, b) => {
          // Primary sort: score (descending)
          if (b.verification.score !== a.verification.score) {
            return b.verification.score - a.verification.score;
          }
          // Secondary sort: timestamp (ascending - earlier submission wins tie)
          return new Date(a.timestamp) - new Date(b.timestamp);
        });

      const winners = validSubmissions.slice(0, maxWinners);

      // Calculate reward distribution
      const rewardDistribution = this.calculateRewardDistribution(winners, maxWinners);

      logger.info(`Determined ${winners.length} winners from ${submissions.length} submissions`);

      return {
        winners: winners.map((winner, index) => ({
          submissionId: winner.submissionId,
          submitter: winner.submitter,
          score: winner.verification.score,
          rank: index + 1,
          rewardPercentage: rewardDistribution[index]
        })),
        totalSubmissions: submissions.length,
        validSubmissions: validSubmissions.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to determine winners:', error);
      throw error;
    }
  }

  // Calculate reward distribution percentages
  calculateRewardDistribution(winners, maxWinners) {
    const distributions = {
      1: [100], // 1st place gets 100%
      2: [70, 30], // 1st: 70%, 2nd: 30%
      3: [50, 30, 20] // 1st: 50%, 2nd: 30%, 3rd: 20%
    };

    const winnerCount = Math.min(winners.length, maxWinners);
    return distributions[winnerCount] || distributions[3];
  }

  // Detect potential fraud or manipulation
  async detectFraud(submission, previousSubmissions) {
    try {
      const fraudChecks = {
        duplicateContent: this.checkDuplicateContent(submission, previousSubmissions),
        unusualTiming: this.checkUnusualTiming(submission),
        metadataInconsistencies: this.checkMetadataConsistency(submission),
        scoreAnomalies: this.checkScoreAnomalies(submission, previousSubmissions)
      };

      const suspiciousFlags = Object.values(fraudChecks).filter(check => check.suspicious);
      const riskScore = (suspiciousFlags.length / Object.keys(fraudChecks).length) * 100;

      return {
        riskScore,
        fraudChecks,
        recommendation: riskScore > 50 ? 'reject' : riskScore > 25 ? 'review' : 'approve'
      };
    } catch (error) {
      logger.error('Fraud detection failed:', error);
      return { riskScore: 0, fraudChecks: {}, recommendation: 'approve' };
    }
  }

  checkDuplicateContent(submission, previousSubmissions) {
    const contentHash = submission.proofHash;
    const duplicate = previousSubmissions.find(prev => prev.proofHash === contentHash);
    
    return {
      suspicious: !!duplicate,
      reason: duplicate ? 'Duplicate content hash detected' : 'Content appears unique'
    };
  }

  checkUnusualTiming(submission) {
    const submissionTime = new Date(submission.timestamp);
    const now = new Date();
    const timeDiff = Math.abs(now - submissionTime);
    
    // Flag if submission timestamp is more than 5 minutes in the future
    const suspicious = timeDiff > 5 * 60 * 1000 && submissionTime > now;
    
    return {
      suspicious,
      reason: suspicious ? 'Submission timestamp appears manipulated' : 'Timing appears normal'
    };
  }

  checkMetadataConsistency(submission) {
    // Check for basic metadata consistency
    const metadata = submission.metadata || {};
    const hasRequiredFields = metadata.device && metadata.timestamp && metadata.location;
    
    return {
      suspicious: !hasRequiredFields,
      reason: hasRequiredFields ? 'Metadata appears complete' : 'Missing critical metadata'
    };
  }

  checkScoreAnomalies(submission, previousSubmissions) {
    if (previousSubmissions.length < 3) {
      return { suspicious: false, reason: 'Insufficient data for comparison' };
    }

    const scores = previousSubmissions
      .filter(sub => sub.verification)
      .map(sub => sub.verification.score);
    
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const submissionScore = submission.verification?.score || 0;
    
    // Flag if score is unusually high compared to average
    const suspicious = submissionScore > (avgScore + 30) && submissionScore > 80;
    
    return {
      suspicious,
      reason: suspicious ? 'Score significantly higher than average' : 'Score within normal range'
    };
  }

  // Validate AI response format
  validateAIResponse(response) {
    const required = ['isValid', 'score', 'reasoning', 'confidence'];
    const missing = required.filter(field => !(field in response));
    
    if (missing.length > 0) {
      throw new Error(`AI response missing required fields: ${missing.join(', ')}`);
    }

    if (typeof response.isValid !== 'boolean') {
      throw new Error('isValid must be a boolean');
    }

    if (typeof response.score !== 'number' || response.score < 0 || response.score > 100) {
      throw new Error('score must be a number between 0 and 100');
    }

    if (typeof response.confidence !== 'number' || response.confidence < 0 || response.confidence > 1) {
      throw new Error('confidence must be a number between 0 and 1');
    }

    return true;
  }
}

module.exports = new AIService(); 